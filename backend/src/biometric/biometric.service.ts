import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { createPublicKey, verify, constants } from 'crypto';
import {
  BiometricCredential,
  BiometricCredentialDocument,
} from './schemas/biometric-credential.schema';
import { Challenge, ChallengeDocument } from './schemas/challenge.schema';
import { BiometricRegisterDto } from './dto/biometric-register.dto';
import { BiometricVerifyDto } from './dto/biometric-verify.dto';
import { AuthService } from '../auth/auth.service';

/**
 * Biometric authentication service.
 *
 * Handles biometric credential registration, challenge generation,
 * ECDSA signature verification, and credential management.
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
    const existingCredential = await this.credentialModel
      .findOne({ userId, keyAlias: keyAlias ?? null, isActive: true })
      .exec();

    if (existingCredential) {
      this.logger.warn(`Biometric credential already exists for user: ${userId}`);
      throw new BadRequestException('Biometric credential already registered for this device');
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
    const nonce = uuidv4();
    const expiresAt = new Date(
      Date.now() + this.challengeExpiresInSeconds * 1000,
    );

    // Store challenge (publicKey will be set during verification)
    await this.challengeModel.create({
      nonce,
      publicKey: 'pending',
      expiresAt,
    });

    this.logger.debug(`Challenge generated: ${nonce}`);

    return { challenge: nonce };
  }

  /**
   * Verifies a biometric signature against the stored public key.
   *
   * This is the core of the biometric authentication flow:
   * 1. Validates the challenge exists and hasn't expired
   * 2. Finds the credential by public key
   * 3. Verifies the ECDSA signature using the public key
   * 4. Marks the challenge as used
   * 5. Issues a JWT access token
   *
   * @param verifyDto - Contains signature, publicKey, and payload (challenge nonce)
   * @returns JWT access token and user info
   * @throws UnauthorizedException if verification fails
   */
  async verifySignature(
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
    const credential = await this.credentialModel
      .findOne({ publicKey, isActive: true })
      .exec();

    if (!credential) {
      this.logger.warn(`No active credential found for public key`);
      throw new UnauthorizedException('Biometric credential not found');
    }

    // Step 3: Verify the ECDSA signature
    const isSignatureValid = this.verifyEcdsaSignature(
      payload,
      signature,
      publicKey,
    );

    if (!isSignatureValid) {
      this.logger.warn(`Invalid ECDSA signature for user: ${credential.userId}`);
      throw new UnauthorizedException('Invalid biometric signature');
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

    this.logger.log(`Biometric authentication successful for user: ${userId}`);

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
   * Verifies an ECDSA signature using the provided public key.
   *
   * The public key is expected in PEM format. The signature is expected
   * in Base64 encoding. Verification uses SHA-256 as the hash algorithm.
   *
   * @param data - The original data that was signed (challenge nonce)
   * @param signature - The Base64-encoded ECDSA signature
   * @param publicKeyPem - The ECDSA public key in PEM format
   * @returns True if the signature is valid, false otherwise
   */
  private verifyEcdsaSignature(
    data: string,
    signature: string,
    publicKeyPem: string,
  ): boolean {
    try {
      const publicKey = createPublicKey({
        key: publicKeyPem,
        format: 'pem',
        type: 'spki',
      });

      const signatureBuffer = Buffer.from(signature, 'base64');
      const dataBuffer = Buffer.from(data, 'utf-8');

      return verify(
        null,
        dataBuffer,
        {
          key: publicKey,
          padding: undefined,
          dsaEncoding: 'der',
        },
        signatureBuffer,
      );
    } catch (error) {
      this.logger.error(
        `ECDSA signature verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return false;
    }
  }
}
