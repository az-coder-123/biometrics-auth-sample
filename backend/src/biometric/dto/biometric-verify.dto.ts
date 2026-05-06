import { IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for biometric signature verification (WebAuthn).
 *
 * Sent by the client after the device signs the challenge nonce
 * via the WebAuthn API. The backend verifies the assertion signature
 * against the stored public key using the WebAuthn verification format.
 */
export class BiometricVerifyDto {
  /** Base64url-encoded credential ID (stored as keyAlias during registration). */
  @IsString()
  @IsNotEmpty({ message: 'Credential ID is required' })
  credentialId: string;

  /** Base64url-encoded assertion signature from WebAuthn. */
  @IsString()
  @IsNotEmpty({ message: 'Signature is required' })
  signature: string;

  /** Base64url-encoded authenticator data from WebAuthn assertion. */
  @IsString()
  @IsNotEmpty({ message: 'Authenticator data is required' })
  authenticatorData: string;

  /** Base64url-encoded client data JSON from WebAuthn assertion. */
  @IsString()
  @IsNotEmpty({ message: 'Client data JSON is required' })
  clientDataJSON: string;

  /** The challenge nonce that was originally sent to the client. */
  @IsString()
  @IsNotEmpty({ message: 'Payload (challenge nonce) is required' })
  payload: string;
}