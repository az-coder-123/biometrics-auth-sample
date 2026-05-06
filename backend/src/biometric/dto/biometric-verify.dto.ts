import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for biometric signature verification.
 *
 * Sent by the client after the device signs the challenge nonce.
 * The backend verifies the ECDSA signature against the stored public key.
 */
export class BiometricVerifyDto {
  @IsString()
  @IsNotEmpty({ message: 'Signature is required' })
  signature: string;

  @IsString()
  @IsNotEmpty({ message: 'Public key is required' })
  publicKey: string;

  @IsString()
  @IsNotEmpty({ message: 'Payload (challenge nonce) is required' })
  payload: string;
}
