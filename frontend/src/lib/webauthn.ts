/**
 * WebAuthn (Web Authentication) utility.
 *
 * Wraps the browser's Web Authentication API to handle biometric
 * credential registration and authentication using platform authenticators
 * (fingerprint, face recognition, etc.).
 *
 * Uses ES256 (ECDSA with P-256 + SHA-256) to match the backend's
 * ECDSA signature verification.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a biometric registration operation. */
export interface BiometricRegistrationResult {
  /** Base64url-encoded public key. */
  publicKey: string;
  /** Base64url-encoded credential ID. */
  credentialId: string;
}

/** Result of a biometric authentication (signing) operation. */
export interface BiometricAuthResult {
  /** Base64url-encoded signature. */
  signature: string;
  /** Base64url-encoded authenticator data. */
  authenticatorData: string;
  /** Base64url-encoded client data JSON. */
  clientDataJSON: string;
}

// ---------------------------------------------------------------------------
// Encoding Helpers
// ---------------------------------------------------------------------------

/**
 * Converts an ArrayBuffer to a Base64url-encoded string.
 *
 * @param buffer - ArrayBuffer to encode
 * @returns Base64url string without padding
 */
function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Converts a Base64url string to a Uint8Array.
 *
 * @param base64url - Base64url-encoded string
 * @returns Decoded byte array
 */
function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks whether the browser supports WebAuthn.
 *
 * @returns True if WebAuthn is available
 */
export function isWebAuthnSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

/**
 * Checks whether a platform authenticator (biometric) is available.
 *
 * @returns True if platform authenticator is available
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
}

/**
 * Generates a random byte array encoded as Base64url.
 * Used as a challenge nonce when the server challenge is not available yet.
 *
 * @param length - Number of random bytes (default: 32)
 * @returns Base64url-encoded random string
 */
export function generateRandomBuffer(length: number = 32): string {
  const buffer = new Uint8Array(length);
  crypto.getRandomValues(buffer);
  return bufferToBase64url(buffer.buffer);
}

/**
 * Registers a new biometric credential using the platform authenticator.
 *
 * Creates a new credential tied to the user and relying party,
 * then returns the public key and credential ID.
 *
 * @param rpName - Human-readable relying party name
 * @param userId - User's unique identifier (hex string from MongoDB)
 * @param userEmail - User's email address
 * @param challenge - Server-provided challenge nonce (Base64url)
 * @returns Registration result with public key and credential ID
 * @throws Error if WebAuthn is not supported or user denies permission
 */
export async function registerBiometricCredential(
  rpName: string,
  userId: string,
  userEmail: string,
  challenge: string
): Promise<BiometricRegistrationResult> {
  if (!isWebAuthnSupported()) {
    throw new Error("WebAuthn is not supported in this browser");
  }

  const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
    challenge: base64urlToBuffer(challenge),
    rp: {
      name: rpName,
    },
    user: {
      id: base64urlToBuffer(userId),
      name: userEmail,
      displayName: userEmail,
    },
    pubKeyCredParams: [
      { alg: -7, type: "public-key" }, // ES256 (ECDSA P-256 + SHA-256)
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      userVerification: "required",
    },
    timeout: 60000,
    attestation: "none",
  };

  const credential = (await navigator.credentials.create({
    publicKey: publicKeyCredentialCreationOptions,
  })) as PublicKeyCredential;

  if (!credential) {
    throw new Error("Failed to create biometric credential");
  }

  const response = credential.response as AuthenticatorAttestationResponse;

  // Export the public key from the attestation object
  const publicKeyBuffer = response.getPublicKey();
  if (!publicKeyBuffer) {
    throw new Error("Failed to extract public key from credential");
  }

  return {
    publicKey: bufferToBase64url(publicKeyBuffer),
    credentialId: bufferToBase64url(credential.rawId),
  };
}

/**
 * Authenticates using a registered biometric credential.
 *
 * Prompts the user for biometric verification, then signs the challenge
 * with the credential's private key.
 *
 * @param challenge - Server-provided challenge nonce (Base64url)
 * @param credentialIds - List of registered credential IDs (Base64url)
 * @returns Authentication result with signature and client data
 * @throws Error if authentication fails or is cancelled
 */
export async function authenticateWithBiometric(
  challenge: string,
  credentialIds: string[]
): Promise<BiometricAuthResult> {
  if (!isWebAuthnSupported()) {
    throw new Error("WebAuthn is not supported in this browser");
  }

  if (credentialIds.length === 0) {
    throw new Error("No biometric credentials registered");
  }

  const allowCredentials: PublicKeyCredentialDescriptor[] = credentialIds.map(
    (id) => ({
      id: base64urlToBuffer(id),
      type: "public-key" as const,
      transports: ["internal"] as AuthenticatorTransport[],
    })
  );

  const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
    challenge: base64urlToBuffer(challenge),
    allowCredentials,
    userVerification: "required",
    timeout: 60000,
  };

  const assertion = (await navigator.credentials.get({
    publicKey: publicKeyCredentialRequestOptions,
  })) as PublicKeyCredential;

  if (!assertion) {
    throw new Error("Biometric authentication was cancelled or failed");
  }

  const response = assertion.response as AuthenticatorAssertionResponse;

  return {
    signature: bufferToBase64url(response.signature),
    authenticatorData: bufferToBase64url(response.authenticatorData),
    clientDataJSON: bufferToBase64url(response.clientDataJSON),
  };
}

/**
 * Converts a Base64url-encoded public key to PEM format.
 *
 * The backend stores public keys in DER/Base64url format.
 * This helper converts them for display or further processing.
 *
 * @param base64urlPublicKey - Base64url-encoded public key
 * @returns PEM-formatted public key string
 */
export function publicKeyToPem(base64urlPublicKey: string): string {
  const base64 = base64urlPublicKey.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const lines = padded.match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----`;
}