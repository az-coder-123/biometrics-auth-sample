import { IsNotEmpty, IsString, IsOptional } from 'class-validator';

/**
 * DTO for biometric credential registration.
 *
 * Sent by the client after creating a hardware-backed key pair on the device.
 * The public key is stored server-side for subsequent signature verification.
 */
export class BiometricRegisterDto {
  @IsString()
  @IsNotEmpty({ message: 'User ID is required' })
  userId: string;

  @IsString()
  @IsNotEmpty({ message: 'Public key is required' })
  publicKey: string;

  @IsString()
  @IsOptional()
  keyAlias?: string;
}
