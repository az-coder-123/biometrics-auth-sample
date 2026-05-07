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

    // Check if credential already exists for this exact publicKey (same device re-registering)
    const existingByPublicKey = await this.credentialModel
      .findOne({ userId, publicKey, isActive: true })
      .exec();

    if (existingByPublicKey) {
      this.logger.log(`Credential already exists for this device (user: ${userId})`);
      // Same device, same key → no changes needed
      return existingByPublicKey;
    }

    // Check if credential exists with same keyAlias but DIFFERENT publicKey.
    // This happens when the user re-registers on the same device (key was regenerated).
    // Update the existing credential with the new public key.
    const existingByKeyAlias = await this.credentialModel
      .findOne({ userId, keyAlias: keyAlias ?? null, isActive: true })
      .exec();

    if (existingByKeyAlias && existingByKeyAlias.publicKey !== publicKey) {
      this.logger.log(
        `Different publicKey detected for keyAlias "${keyAlias ?? 'null'}" ` +
        `(user: ${userId}). Updating existing credential with new publicKey.`
      );

      existingByKeyAlias.publicKey = publicKey;
      const savedCredential = await existingByKeyAlias.save();
      this.logger.log(`Biometric credential updated for user: ${userId}`);
      return savedCredential;
    }

    // No existing credential — create new one
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
   * Checks if a user has an active native biometric credential.
   *
   * This method looks for credentials that have a keyAlias matching
   * the native pattern (not WebAuthn credentials which use credentialId).
   *
   * @param userId - The user ID to check
   * @returns Object with hasCredential boolean
   */
  async hasNativeCredential(userId: string): Promise<{ hasCredential: boolean; keyAlias?: string }> {
    const credential = await this.credentialModel
      .findOne({
        userId,
        keyAlias: { $ne: null },
        isActive: true,
      })
      .exec();

    if (credential) {
      return {
        hasCredential: true,
        keyAlias: credential.keyAlias ?? undefined,
      };
    }

    return { hasCredential: false };
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
   * Verifies a native biometric signature (auto-detects ECDSA or RSA).
   *
   * Native biometric verification flow:
   * 1. Validate the challenge exists and hasn't expired
   * 2. Find the credential by public key
   * 3. Auto-detect key type and verify the signature (ECDSA-SHA256 or RSA-SHA256)
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

    // Step 3: Verify the signature
    try {
      // Reconstruct public key in PEM format.
      // The mobile app sends base64-encoded SPKI DER (no PEM headers).
      // Skip wrapping if PEM headers are already present.
      const publicKeyPem = publicKey.includes('-----BEGIN')
        ? publicKey
        : `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`;

      const publicKeyObject = createPublicKey(publicKeyPem);

      // Detect key type and use appropriate verification algorithm.
      // The biometric_signature Flutter plugin generates ECDSA (P-256) keys,
      // but older credentials might use RSA. Auto-detect from the key.
      const keyType = publicKeyObject.asymmetricKeyType; // 'ec' or 'rsa'
      this.logger.debug(`Detected key type: ${keyType} for native biometric verification`);

      // Decode the signature — mobile plugins may return base64 or base64url.
      const signatureBuffer = this.decodeBase64Flexible(signature);

      const dataBuffer = Buffer.from(payload, 'utf-8');

      let isValid: boolean;

      if (keyType === 'ec') {
        // ECDSA verification.
        // Try DER-encoded signature first (standard for Android Keystore / iOS Secure Enclave).
        isValid = verify(
          null, // algorithm inferred from key (ECDSA-SHA256 for P-256)
          dataBuffer,
          { key: publicKeyObject, dsaEncoding: 'der' },
          signatureBuffer,
        );

        // If DER fails, try raw r||s (32+32 bytes for P-256).
        // Some plugins return uncompressed r||s instead of DER.
        if (!isValid && signatureBuffer.length === 64) {
          this.logger.debug('DER verification failed, trying raw r||s format');
          const derSignature = this.rawEcdsaToDer(signatureBuffer);
          isValid = verify(
            null,
            dataBuffer,
            { key: publicKeyObject, dsaEncoding: 'der' },
            derSignature,
          );
        }
      } else {
        // RSA-SHA256 verification (legacy fallback)
        isValid = verify(
          'RSA-SHA256',
          dataBuffer,
          publicKeyObject,
          signatureBuffer,
        );
      }

      if (!isValid) {
        this.logger.warn(`Invalid native biometric signature (keyType: ${keyType}) for user: ${credential.userId}`);
        throw new UnauthorizedException('Invalid biometric signature');
      }

      this.logger.log(`Native biometric signature verified (keyType: ${keyType}) for user: ${credential.userId}`);
    } catch (error) {
      // Re-throw our own UnauthorizedExceptions
      if (error instanceof UnauthorizedException) throw error;
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

  /**
   * Decodes a base64 or base64url-encoded string to a Buffer.
   *
   * Mobile plugins may return signatures in either format.
   * This method normalises the input before decoding.
   *
   * @param input - Base64 or base64url-encoded string
   * @returns Decoded Buffer
   */
  private decodeBase64Flexible(input: string): Buffer {
    // Normalize base64url to base64
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    return Buffer.from(padded, 'base64');
  }

  /**
   * Converts a raw ECDSA P-256 signature (r || s, 32 bytes each) to DER format.
   *
   * Android Keystore and some Flutter plugins return the raw concatenation
   * of r and s integers instead of the DER-encoded SEQUENCE required by
   * Node.js crypto with dsaEncoding: 'der'.
   *
   * DER structure:
   *   0x30 <len> 0x02 <r_len> <r_bytes> 0x02 <s_len> <s_bytes>
   *
   * @param rawSignature - 64-byte buffer (r || s, 32 bytes each)
   * @returns DER-encoded signature buffer
   */
  private rawEcdsaToDer(rawSignature: Buffer): Buffer {
    // Split into r and s (each 32 bytes for P-256)
    const r = rawSignature.subarray(0, 32);
    const s = rawSignature.subarray(32, 64);

    // DER-encode each integer (prepend 0x00 if high bit is set to keep it positive)
    const rDer = this.derEncodeInteger(r);
    const sDer = this.derEncodeInteger(s);

    // SEQUENCE { INTEGER r, INTEGER s }
    const content = Buffer.concat([rDer, sDer]);
    return Buffer.concat([Buffer.from([0x30, content.length]), content]);
  }

  /**
   * DER-encodes a big integer for ECDSA signatures.
   *
   * Prepends a leading zero byte if the high bit is set (to keep the
   * value positive in ASN.1 two's-complement representation).
   *
   * @param value - Raw integer bytes
   * @returns DER-encoded INTEGER: 0x02 <len> <bytes>
   */
  private derEncodeInteger(value: Buffer): Buffer {
    // Remove leading zeros
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) {
      start++;
    }

    let trimmed = value.subarray(start);

    // Prepend 0x00 if high bit is set (keep positive)
    if (trimmed[0] & 0x80) {
      trimmed = Buffer.concat([Buffer.from([0x00]), trimmed]);
    }

    return Buffer.concat([Buffer.from([0x02, trimmed.length]), trimmed]);
  }
}