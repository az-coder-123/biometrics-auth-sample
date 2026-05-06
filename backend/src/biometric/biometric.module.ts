import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BiometricService } from './biometric.service';
import { BiometricController } from './biometric.controller';
import {
  BiometricCredential,
  BiometricCredentialSchema,
} from './schemas/biometric-credential.schema';
import { Challenge, ChallengeSchema } from './schemas/challenge.schema';
import { AuthModule } from '../auth/auth.module';

/**
 * Biometric authentication module.
 *
 * Provides biometric credential registration, challenge-response
 * authentication, and ECDSA signature verification.
 * Imports AuthModule to access AuthService for user lookup and token generation.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BiometricCredential.name, schema: BiometricCredentialSchema },
      { name: Challenge.name, schema: ChallengeSchema },
    ]),
    AuthModule,
  ],
  controllers: [BiometricController],
  providers: [BiometricService],
  exports: [BiometricService],
})
export class BiometricModule {}
