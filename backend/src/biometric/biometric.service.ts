import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, createPublicKey, randomBytes, verify } from 'crypto';
import { Model } from 'mongoose';
import { AuthService } from '../auth/auth.service';
import { BiometricRegisterDto } from './dto/biometric-register.dto';
import { BiometricVerifyDto } from './dto/biometric-verify.dto';
import {
  BiometricCredential,
  BiometricCredentialDocument,
} from './schemas/biometric-credential.schema';
import { Challenge, ChallengeDocument } from './schemas/challenge.schema';

/**
 * Biometric authentication service.
 *
 * Handles biometric credential registration, challenge generation,
 * WebAuthn assertion verification, and credential management.
 *
 * Follows Single Responsibility Principle by focusing solely on
 * biometric authentication logic.
 */
@Injectable()
export class BiometricService {
  private readonly logger = new Logger(BiometricService.name);
  private readonly challengeExpiresInSeconds: number;

  constructor(
    @InjectModel(BiometricCredential.name)
    private readonly credentialModel: Model<BiometricCredentialDocument>,
    @InjectModel(Challenge.name)
    private readonly challengeModel: Model<ChallengeDocument>,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    this.challengeExpiresInSeconds = this.configService.get<number>(
      'biometric.challengeExpiresInSeconds',
      300,
    );
  }

  /**
   * Registers a biometric credential for a user.
   *
   * Stores the device-generated public key so it can be used for
   * subsequent biometric authentication challenges.
   *
   * @param registerDto - Contains userId, publicKey, and optional keyAlias
   * @returns The created credential document
   * @throws BadRequestException if user not found or credential already exists
   */
  async registerCredential(registerDto: BiometricRegisterDto): Promise<BiometricCredentialDocument> {
    const { userId, publicKey, keyAlias } = registerDto;

    // Verify user exists
    const user = await this.authService.findUserById(userId);
    if (!user) {
      this.logger.warn(`Biometric registration attempted for non-existent user: ${userId}`);
      throw new BadRequestException('User not found');
    }

    // Check if credential already exists for this keyAlias
    // If it exists, UPDATE it instead of throwing an error
    const existingCredential = await this.credentialModel
      .findOne({ userId, keyAlias: keyAlias ?? null, isActive: true })
      .exec();

    if (existingCredential) {
      this.logger.log(`Updating existing biometric credential for user: ${userId}`);
      existingCredential.publicKey = publicKey;
      existingCredential.isActive = true;
      const updated = await existingCredential.save();
      return updated;
    }

    const credential = new this.credentialModel({
      userId,
      publicKey,
      keyAlias: keyAlias ?? null,
    });

    const savedCredential = await credential.save();
    this.logger.log(`Biometric credential registered for user: ${userId}`);

    return savedCredential;
  }

  /**
   * Generates a one-time challenge nonce for biometric authentication.
   *
   * The challenge must be signed by the device's private key and
   * verified within the configured expiration time.
   *
   * @returns A unique challenge nonce string
   */
  async generateChallenge(): Promise<{ challenge: string }> {
    // Generate a cryptographically random challenge as base64url-encoded string.
    // WebAuthn requires the challenge to be a byte array passed via base64url encoding.
    // Using crypto.randomBytes ensures proper entropy for the challenge nonce.
    const nonce = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.challengeExpiresInSeconds * 1000,
    );

    await this.challengeModel.create({
      nonce,
      publicKey: 'pending',
      expiresAt,
    });

    this.logger.debug(`Challenge generated: ${nonce}`);

    return { challenge: nonce };
  }

  /**
   * Verifies a biometric signature (supports both WebAuthn and native biometric).
   *
   * Auto-detects format:
   * - If credentialId is present → WebAuthn verification
   * - If publicKey is present → Native biometric verification
   *
   * @param verifyDto - Contains signature and either (credentialId + authenticatorData + clientDataJSON) or (publicKey)
   * @returns JWT access token and user info
   * @throws UnauthorizedException if verification fails
   */
  async verifySignature(
    verifyDto: BiometricVerifyDto,
  ): Promise<{ accessToken: string; userId: string; email: string }> {
    // Auto-detect format and route to appropriate verification method
    if (verifyDto.credentialId) {
      // WebAuthn format
      return this.verifyWebAuthnSignature(verifyDto);
    } else if (verifyDto.publicKey) {
      // Native biometric format
      return this.verifyNativeBiometric(verifyDto);
    } else {
      this.logger.warn('Invalid verification request: missing credentialId or publicKey');
      throw new UnauthorizedException('Either credentialId or publicKey is required');
    }
  }

  /**
   * Verifies a WebAuthn assertion signature against the stored public key.
   *
   * WebAuthn assertion verification flow:
   * 1. Validate the challenge exists and hasn't expired
   * 2. Find the credential by credentialId (stored as keyAlias)
   * 3. Validate clientDataJSON contains the correct challenge and type
   * 4. Reconstruct the signed data: authenticatorData + SHA-256(clientDataJSON)
   * 5. Verify the ECDSA signature using the stored public key
   * 6. Mark the challenge as used and issue a JWT token
   *
   * @param verifyDto - Contains credentialId, signature, authenticatorData, clientDataJSON, payload
   * @returns JWT access token and user info
   * @throws UnauthorizedException if verification fails
   */
  private async verifyWebAuthnSignature(
    verifyDto: BiometricVerifyDto,
  ): Promise<{ accessToken: string; userId: string; email: string }> {
    const { credentialId, signature, authenticatorData, clientDataJSON, payload } = verifyDto;

    // Validate required WebAuthn fields
    if (!credentialId || !authenticatorData || !clientDataJSON) {
      this.logger.warn('Missing required WebAuthn fields');
      throw new UnauthorizedException('credentialId, authenticatorData, and clientDataJSON are required for WebAuthn verification');
    }

    // Step 1: Validate the challenge
    const challenge = await this.challengeModel.findOne({ nonce: payload }).exec();
    if (!challenge) {
      this.logger.warn(`Challenge not found: ${payload}`);
      throw new UnauthorizedException('Invalid or expired challenge');
    }

    if (challenge.isUsed) {
      this.logger.warn(`Challenge already used: ${payload}`);
      throw new UnauthorizedException('Challenge has already been used');
    }

    if (new Date() > challenge.expiresAt) {
      this.logger.warn(`Challenge expired: ${payload}`);
      throw new UnauthorizedException('Challenge has expired');
    }

    // Step 2: Find the credential by keyAlias (credentialId)
    const credential = await this.credentialModel
      .findOne({ keyAlias: credentialId, isActive: true })
      .exec();

    if (!credential) {
      this.logger.warn(`No active credential found for credentialId: ${credentialId}`);
      throw new UnauthorizedException('Biometric credential not found');
    }

    // Step 3: Validate clientDataJSON contains the correct challenge
    this.validateClientData(clientDataJSON, payload);

    // Step 4: Reconstruct signed data and verify the signature
    const isSignatureValid = this.verifyWebAuthnAssertion(
      authenticatorData,
      clientDataJSON,
      signature,
      credential.publicKey,
    );

    if (!isSignatureValid) {
      this.logger.warn(`Invalid WebAuthn assertion for user: ${credential.userId}`);
      throw new UnauthorizedException('Invalid biometric signature');
    }

    // Step 5: Mark challenge as used
    challenge.isUsed = true;
    await challenge.save();

    // Step 6: Generate JWT token
    const userId = credential.userId.toString();
    const user = await this.authService.findUserById(userId);

    if (!user) {
      this.logger.error(`User not found for credential: ${userId}`);
      throw new UnauthorizedException('User account not found');
    }

    if (!user.isActive) {
      this.logger.warn(`Inactive user attempted biometric login: ${userId}`);
      throw new UnauthorizedException('Account is deactivated');
    }

    const accessToken = this.authService.generateFullToken(userId, user.email);

    this.logger.log(`Biometric authentication successful for user: ${userId}`);

    return {
      accessToken,
      userId,
      email: user.email,
    };
  }

  /**
   * Verifies a native biometric signature (RSA-SHA256).
   *
   * Native biometric verification flow:
   * 1. Validate the challenge exists and hasn't expired
   * 2. Find the credential by public key
   * 3. Verify the RSA signature using crypto.verify
   * 4. Mark the challenge as used and issue a JWT token
   *
   * @param verifyDto - Contains signature, publicKey, and payload (challenge)
   * @returns JWT access token and user info
   * @throws UnauthorizedException if verification fails
   */
  async verifyNativeBiometric(
    verifyDto: BiometricVerifyDto,
  ): Promise<{ accessToken: string; userId: string; email: string }> {
    const { signature, publicKey, payload } = verifyDto;

    // Step 1: Validate the challenge
    const challenge = await this.challengeModel.findOne({ nonce: payload }).exec();
    if (!challenge) {
      this.logger.warn(`Challenge not found: ${payload}`);
      throw new UnauthorizedException('Invalid or expired challenge');
    }

    if (challenge.isUsed) {
      this.logger.warn(`Challenge already used: ${payload}`);
      throw new UnauthorizedException('Challenge has already been used');
    }

    if (new Date() > challenge.expiresAt) {
      this.logger.warn(`Challenge expired: ${payload}`);
      throw new UnauthorizedException('Challenge has expired');
    }

    // Step 2: Find the credential by public key
    if (!publicKey) {
      this.logger.warn('Public key is required for native biometric verification');
      throw new UnauthorizedException('Public key is required');
    }

    const credential = await this.credentialModel
      .findOne({ publicKey, isActive: true })
      .exec();

    if (!credential) {
      this.logger.warn(`No active credential found for publicKey: ${publicKey.substring(0, 20)}...`);
      throw new UnauthorizedException('Biometric credential not found');
    }

    // Step 3: Verify the RSA signature
    try {
      // Reconstruct public key in PEM format
      const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`;
      const publicKeyObject = createPublicKey(publicKeyPem);

      // Verify signature
      const isValid = verify(
        'RSA-SHA256',
        Buffer.from(payload, 'utf-8'),
        publicKeyObject,
        Buffer.from(signature, 'base64'),
      );

      if (!isValid) {
        this.logger.warn(`Invalid native biometric signature for user: ${credential.userId}`);
        throw new UnauthorizedException('Invalid biometric signature');
      }
    } catch (error) {
      this.logger.error(`Signature verification error: ${error instanceof Error ? error.message : String(error)}`);
      throw new UnauthorizedException('Signature verification failed');
    }

    // Step 4: Mark challenge as used
    challenge.isUsed = true;
    await challenge.save();

    // Step 5: Generate JWT token
    const userId = credential.userId.toString();
    const user = await this.authService.findUserById(userId);

    if (!user) {
      this.logger.error(`User not found for credential: ${userId}`);
      throw new UnauthorizedException('User account not found');
    }

    if (!user.isActive) {
      this.logger.warn(`Inactive user attempted biometric login: ${userId}`);
      throw new UnauthorizedException('Account is deactivated');
    }

    const accessToken = this.authService.generateFullToken(userId, user.email);

    this.logger.log(`Native biometric authentication successful for user: ${userId}`);

    return {
      accessToken,
      userId,
      email: user.email,
    };
  }

  /**
   * Removes a biometric credential for a user.
   *
   * Called when the user disables biometric login on a device.
   * Requires a valid JWT token to identify the user.
   *
   * @param userId - The authenticated user's ID
   * @param publicKey - Optional public key to remove specific credential
   * @returns Confirmation message
   */
  async unregisterCredential(
    userId: string,
    publicKey?: string,
  ): Promise<{ message: string }> {
    const filter: Record<string, unknown> = { userId, isActive: true };
    if (publicKey) {
      filter.publicKey = publicKey;
    }

    const result = await this.credentialModel
      .updateMany(filter, { isActive: false })
      .exec();

    if (result.modifiedCount === 0) {
      this.logger.warn(`No biometric credentials found to unregister for user: ${userId}`);
      throw new NotFoundException('No biometric credentials found');
    }

    this.logger.log(
      `Unregistered ${result.modifiedCount} biometric credential(s) for user: ${userId}`,
    );

    return { message: 'Biometric credential unregistered successfully' };
  }

  /**
   * Validates the WebAuthn clientDataJSON.
   *
   * Ensures the challenge in the client data matches the expected challenge
   * and that the type is "webauthn.get" (authentication).
   *
   * @param clientDataJSON - Base64url-encoded client data from the assertion
   * @param expectedChallenge - The challenge nonce that was sent to the client
   * @throws UnauthorizedException if validation fails
   */
  private validateClientData(clientDataJSON: string, expectedChallenge: string): void {
    const decoded = Buffer.from(clientDataJSON, 'base64').toString('utf-8');

    let clientData: Record<string, unknown>;
    try {
      clientData = JSON.parse(decoded);
    } catch {
      this.logger.warn('Failed to parse clientDataJSON');
      throw new UnauthorizedException('Invalid client data format');
    }

    // Verify the type is "webauthn.get" (authentication assertion)
    if (clientData.type !== 'webauthn.get') {
      this.logger.warn(`Invalid client data type: ${clientData.type}`);
      throw new UnauthorizedException('Invalid authentication type');
    }

    // Verify the challenge matches.
    // The server generates challenges as base64url-encoded random bytes.
    // The client passes this directly to WebAuthn, which base64url-encodes
    // the ArrayBuffer back — so clientData.challenge should equal our stored nonce.
    const receivedChallenge = clientData.challenge as string;
    if (!receivedChallenge) {
      this.logger.warn('Missing challenge in client data');
      throw new UnauthorizedException('Missing challenge in client data');
    }

    if (receivedChallenge !== expectedChallenge) {
      this.logger.warn('Challenge mismatch in client data');
      throw new UnauthorizedException('Challenge verification failed');
    }
  }

  /**
   * Verifies a WebAuthn assertion signature.
   *
   * The WebAuthn spec defines the signed data as:
   *   authenticatorData || SHA-256(clientDataJSON)
   *
   * The signature is an ECDSA signature over this concatenated data,
   * using the credential's private key. We verify against the stored public key.
   *
   * @param authenticatorDataBase64url - Base64url-encoded authenticator data
   * @param clientDataJSONBase64url - Base64url-encoded client data JSON
   * @param signatureBase64url - Base64url-encoded ECDSA signature
   * @param storedPublicKey - Base64url-encoded COSE public key (from registration)
   * @returns True if the signature is valid
   */
  private verifyWebAuthnAssertion(
    authenticatorDataBase64url: string,
    clientDataJSONBase64url: string,
    signatureBase64url: string,
    storedPublicKey: string,
  ): boolean {
    try {
      // Convert the stored COSE public key to PEM format
      const pem = this.coseEc2ToPem(storedPublicKey);

      // Reconstruct the signed data: authenticatorData || SHA-256(clientDataJSON)
      const authenticatorData = Buffer.from(
        this.base64urlToBuffer(authenticatorDataBase64url),
      );
      const clientDataJSON = Buffer.from(
        this.base64urlToBuffer(clientDataJSONBase64url),
      );
      const clientDataHash = createHash('sha256').update(clientDataJSON).digest();
      const signedData = Buffer.concat([authenticatorData, clientDataHash]);

      // Convert signature from base64url to buffer
      const signatureBuffer = Buffer.from(
        this.base64urlToBuffer(signatureBase64url),
      );

      // Verify using Node.js crypto
      const publicKey = createPublicKey({
        key: pem,
        format: 'pem',
        type: 'spki',
      });

      return verify(
        null,
        signedData,
        {
          key: publicKey,
          dsaEncoding: 'der',
        },
        signatureBuffer,
      );
    } catch (error) {
      this.logger.error(
        `WebAuthn assertion verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    }
  }

  /**
   * Converts a COSE EC2 (P-256) public key to PEM format.
   *
   * WebAuthn's `getPublicKey()` returns a COSE_Key structure in CBOR encoding.
   * This method extracts the x and y coordinates and constructs a proper
   * SubjectPublicKeyInfo (SPKI) in PEM format for use with Node.js crypto.
   *
   * COSE_Key structure for EC2 P-256:
   *   { 1: 2, 3: -7, -1: 1, -2: xBytes, -3: yBytes }
   *
   * @param coseKeyBase64url - Base64url-encoded COSE_Key
   * @returns PEM-formatted public key string
   * @throws Error if the key cannot be parsed
   */
  private coseEc2ToPem(coseKeyBase64url: string): string {
    const coseBytes = Buffer.from(this.base64urlToBuffer(coseKeyBase64url));

    // Check if already SPKI/PEM format (starts with -----BEGIN)
    if (coseKeyBase64url.startsWith('-----BEGIN')) {
      return coseKeyBase64url;
    }

    // Extract x and y coordinates from COSE_Key CBOR encoding
    // CBOR byte string for 32 bytes: 0x58 0x20
    // COSE key -2 (0x21) = x coordinate, -3 (0x22) = y coordinate
    let x: Buffer | undefined;
    let y: Buffer | undefined;

    for (let i = 0; i < coseBytes.length - 3; i++) {
      // Look for byte string pattern: key tag + 0x58 0x20 + 32 bytes
      if (coseBytes[i] === 0x21 && coseBytes[i + 1] === 0x58 && coseBytes[i + 2] === 0x20) {
        x = coseBytes.subarray(i + 3, i + 3 + 32);
      }
      if (coseBytes[i] === 0x22 && coseBytes[i + 1] === 0x58 && coseBytes[i + 2] === 0x20) {
        y = coseBytes.subarray(i + 3, i + 3 + 32);
      }
    }

    if (!x || !y || x.length !== 32 || y.length !== 32) {
      this.logger.warn('Failed to parse COSE EC2 key, attempting SPKI fallback');
      // Fallback: try treating as raw SPKI DER
      return this.derToPem(coseBytes);
    }

    // Construct uncompressed EC point: 0x04 || x || y
    const uncompressedPoint = Buffer.concat([
      Buffer.from([0x04]),
      x,
      y,
    ]);

    // Construct SubjectPublicKeyInfo ASN.1 DER structure
    // SEQUENCE { SEQUENCE { OID ecPublicKey, OID prime256v1 }, BIT STRING { point } }
    const ecOid = Buffer.from([
      0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, // OID 1.2.840.10045.2.1 (ecPublicKey)
    ]);
    const p256Oid = Buffer.from([
      0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, // OID 1.2.840.10045.3.1.7 (P-256)
    ]);

    const algorithmSeqContent = Buffer.concat([ecOid, p256Oid]);
    const algorithmSeq = Buffer.concat([
      Buffer.from([0x30, algorithmSeqContent.length]),
      algorithmSeqContent,
    ]);

    const bitStringContent = Buffer.concat([
      Buffer.from([0x00]), // no unused bits
      uncompressedPoint,
    ]);
    const bitString = Buffer.concat([
      Buffer.from([0x03, bitStringContent.length]),
      bitStringContent,
    ]);

    const spkiContent = Buffer.concat([algorithmSeq, bitString]);
    const spki = Buffer.concat([
      Buffer.from([0x30, spkiContent.length]),
      spkiContent,
    ]);

    return this.derToPem(spki);
  }

  /**
   * Converts a DER-encoded SubjectPublicKeyInfo to PEM format.
   *
   * @param derBuffer - DER-encoded public key bytes
   * @returns PEM-formatted public key string
   */
  private derToPem(derBuffer: Buffer): string {
    const base64 = derBuffer.toString('base64');
    const lines = base64.match(/.{1,64}/g) || [];
    return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
  }

  /**
   * Decodes a Base64url string to a hex-encoded buffer representation.
   *
   * @param base64url - Base64url-encoded string
   * @returns Buffer from the decoded bytes
   */
  private base64urlToBuffer(base64url: string): Buffer {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return Buffer.from(padded, 'base64');
  }
}