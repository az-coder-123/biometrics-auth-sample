import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * DTO for biometric signature verification.
 *
 * Supports two authentication methods:
 * 1. **Native biometric** — signature + publicKey + payload
 * 2. **WebAuthn** — credentialId + signature + authenticatorData + clientDataJSON + payload
 */
export class BiometricVerifyDto {
  /** Base64url-encoded credential ID (for WebAuthn). */
  @IsString()
  @IsOptional()
  credentialId?: string;

  /** Base64-encoded signature. */
  @IsString()
  @IsNotEmpty({ message: 'Signature is required' })
  signature!: string;

  /** Base64url-encoded authenticator data (for WebAuthn). */
  @IsString()
  @IsOptional()
  authenticatorData?: string;

  /** Base64url-encoded client data JSON (for WebAuthn). */
  @IsString()
  @IsOptional()
  clientDataJSON?: string;

  /** Base64-encoded public key (for native biometric). */
  @IsString()
  @IsOptional()
  publicKey?: string;

  /** The challenge nonce that was originally sent to the client. */
  @IsString()
  @IsNotEmpty({ message: 'Payload (challenge nonce) is required' })
  payload!: string;
}