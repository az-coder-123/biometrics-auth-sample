import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BiometricService } from './biometric.service';
import { BiometricRegisterDto } from './dto/biometric-register.dto';
import { BiometricVerifyDto } from './dto/biometric-verify.dto';

/**
 * Biometric authentication controller.
 *
 * Exposes REST API endpoints for biometric credential management
 * and authentication. All routes are prefixed with `/api/biometric`.
 *
 * Endpoints:
 * - POST /register   - Store device public key (requires JWT)
 * - POST /challenge  - Generate one-time challenge nonce
 * - POST /verify     - Verify signature and issue access token
 * - POST /unregister - Remove device public key (requires JWT)
 */
@Controller('biometric')
export class BiometricController {
  constructor(private readonly biometricService: BiometricService) {}

  /**
   * Registers a biometric credential for the authenticated user.
   *
   * POST /api/biometric/register
   * Body: { userId, publicKey, keyAlias? }
   */
  @Post('register')
  async register(@Body() registerDto: BiometricRegisterDto) {
    const credential = await this.biometricService.registerCredential(registerDto);
    return {
      message: 'Biometric credential registered successfully',
      credential: {
        id: credential._id,
        publicKey: credential.publicKey,
        keyAlias: credential.keyAlias,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createdAt: (credential as any).createdAt,
      },
    };
  }

  /**
   * Generates a one-time challenge nonce for biometric authentication.
   *
   * POST /api/biometric/challenge
   */
  @Post('challenge')
  async createChallenge() {
    const result = await this.biometricService.generateChallenge();
    return result;
  }

  /**
   * Verifies a biometric signature and returns an access token.
   *
   * POST /api/biometric/verify
   * Body: { signature, publicKey, payload }
   */
  @Post('verify')
  async verify(@Body() verifyDto: BiometricVerifyDto) {
    const result = await this.biometricService.verifySignature(verifyDto);
    return result;
  }

  /**
   * Removes a biometric credential for the authenticated user.
   *
   * POST /api/biometric/unregister
   * Requires JWT token in Authorization header.
   */
  @UseGuards(JwtAuthGuard)
  @Post('unregister')
  async unregister(
    @CurrentUser() user: { userId: string },
    @Body('publicKey') publicKey?: string,
  ) {
    const result = await this.biometricService.unregisterCredential(
      user.userId,
      publicKey,
    );
    return result;
  }
}
