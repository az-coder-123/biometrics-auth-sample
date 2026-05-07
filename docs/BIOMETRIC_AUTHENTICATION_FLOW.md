# Biometric Authentication Flow

This document explains the complete biometric authentication flow for **native mobile devices** (Flutter mobile app with Next.js frontend in WebView).

---

## Overview

The biometric authentication system uses **hardware-backed cryptography** on mobile devices:
- **Android**: Android Keystore with StrongBox (if available)
- **iOS**: Secure Enclave

The flow follows a **challenge-response** pattern where the backend generates a random nonce, the mobile device signs it with the private key (after biometric verification), and the backend verifies the signature using the stored public key.

---

## Architecture Components

```
┌─────────────────────────────────────────────────────────────────┐
│                   Mobile App (Flutter)                          │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  BiometricService (Dart)                                 │   │
│  │  - biometric_signature package: RSA key pair generation  │   │
│  │  - local_auth package: Biometric prompts                 │   │
│  │  - flutter_secure_storage: Key alias persistence         │   │
│  │                                                          │   │
│  │  Hardware Integration:                                   │   │
│  │  - Android: Keystore (STRONGBOX_BACKED)                  │   │
│  │  - iOS: Secure Enclave                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           ▲                                     │
│                           │ JS Bridge                           │
│                           ▼                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  InAppWebView → Next.js Frontend                         │   │
│  │  - BiometricBridge.ts: Native method calls               │   │
│  │  - biometric-context.tsx: React state management         │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                           │
                           │ HTTP/REST
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Backend (NestJS + MongoDB)                    │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  BiometricService (TypeScript)                           │   │
│  │  - Challenge generation (crypto.randomBytes)             │   │
│  │  - Signature verification (crypto.verify with RSA-SHA256)│   │
│  │  - Public key storage (MongoDB)                          │   │
│  │  - JWT token issuance                                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Collections:                                                   │
│  - biometricCredentials: { userId, publicKey, keyAlias, ... }   │
│  - challenges: { nonce, expiresAt, isUsed }                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Flow Diagrams

### 1. Biometric Registration Flow

**Scenario**: User enables biometric login for the first time.

```
User          Frontend         Mobile App         Backend         MongoDB
 │               │                  │                │               │
 │ Click "Enable │                  │                │               │
 │ Biometric"    │                  │                │               │
 ├──────────────▶│                  │                │               │
 │               │                  │                │               │
 │               │ Check if key exists               │               │
 │               ├─────────────────▶│                │               │
 │               │◄─────────────────┤                │               │
 │               │ { exists: false }│                │               │
 │               │                  │                │               │
 │               │ Authenticate + Create Keys        │               │
 │               │ (prompt: "Enable biometric")      │               │
 │               ├─────────────────▶│                │               │
 │               │                  │                │               │
 │               │                  │ 👤 Show biometric prompt       │
 │               │                  │ (fingerprint/face)             │
 │               │                  │                │               │
 │               │                  │ ✓ User authenticates           │
 │               │                  │                │               │
 │               │                  │ Generate RSA-2048 key pair     │
 │               │                  │ (private key: hardware-backed) │
 │               │                  │ (public key: extractable)      │
 │               │                  │                │               │
 │               │◄─────────────────┤                │               │
 │               │ { success: true, │                │               │
 │               │   publicKey: "MIIBIj...",         │               │
 │               │   keyAlias: "biometrics_auth_..." }│              │
 │               │                  │                │               │
 │               │ POST /api/biometric/register      │               │
 │               │ { userId, publicKey, keyAlias }   │               │
 │               ├──────────────────────────────────▶│               │
 │               │                  │                │               │
 │               │                  │                │ Store credential
 │               │                  │                ├──────────────▶│
 │               │                  │                │               │
 │               │◄──────────────────────────────────┤               │
 │               │ { message: "Registered" }         │               │
 │               │                  │                │               │
 │◄──────────────┤                  │                │               │
 │ "Biometric    │                  │                │               │
 │  enabled!"    │                  │                │               │
```

**Key Points**:
- Mobile app **authenticates user BEFORE** creating keys (ensures user intent)
- Private key is **hardware-backed** (cannot be extracted from device)
- Public key is sent to backend for verification during login

---

### 2. Biometric Login Flow

**Scenario**: User logs in with biometric after registration.

```
User          Frontend         Mobile App         Backend         MongoDB
 │               │                  │                │               │
 │ Click "Login  │                  │                │               │
 │ with Bio"     │                  │                │               │
 ├──────────────▶│                  │                │               │
 │               │                  │                │               │
 │               │ POST /api/biometric/challenge     │               │
 │               ├──────────────────────────────────▶│               │
 │               │                  │                │               │
 │               │                  │                │ Generate nonce
 │               │                  │                │ (32 random bytes,
 │               │                  │                │  base64url)
 │               │                  │                │               │
 │               │                  │                │ Store challenge
 │               │                  │                ├──────────────▶│
 │               │                  │                │ { nonce, expiresAt,
 │               │                  │                │   isUsed: false }
 │               │                  │                │               │
 │               │◄──────────────────────────────────┤               │
 │               │ { challenge: "7mzajR7JOxKFy..." } │               │
 │               │                  │                │               │
 │               │ Sign challenge   │                │               │
 │               │ (prompt: "Authenticate to login") │               │
 │               ├─────────────────▶│                │               │
 │               │                  │                │               │
 │               │                  │ 👤 Show biometric prompt       │
 │               │                  │                │               │
 │               │                  │ ✓ User authenticates           │
 │               │                  │                │               │
 │               │                  │ Sign(challenge, privateKey)    │
 │               │                  │ Algorithm: SHA256withRSA       │
 │               │                  │ Output: base64 signature       │
 │               │                  │                │               │
 │               │◄─────────────────┤                │               │
 │               │ { success: true, │                │               │
 │               │   signature: "hG3k9...",          │               │
 │               │   publicKey: "MIIBIj...",         │               │
 │               │   payload: "7mzajR7JOxKFy..." }   │               │
 │               │                  │                │               │
 │               │ POST /api/biometric/verify        │               │
 │               │ { signature, publicKey, payload } │               │
 │               ├──────────────────────────────────▶│               │
 │               │                  │                │               │
 │               │                  │                │ Validate challenge
 │               │                  │                │ (exists, not used,
 │               │                  │                │  not expired)
 │               │                  │                │               │
 │               │                  │                │ Find credential
 │               │                  │                │ by publicKey
 │               │                  │                ├──────────────▶│
 │               │                  │                │◄──────────────┤
 │               │                  │                │ { userId, publicKey }
 │               │                  │                │               │
 │               │                  │                │ Verify signature:
 │               │                  │                │ crypto.verify(
 │               │                  │                │   'RSA-SHA256',
 │               │                  │                │   Buffer(challenge),
 │               │                  │                │   publicKey,
 │               │                  │                │   Buffer(signature)
 │               │                  │                │ )
 │               │                  │                │               │
 │               │                  │                │ ✓ Valid!      │
 │               │                  │                │               │
 │               │                  │                │ Mark challenge used
 │               │                  │                ├──────────────▶│
 │               │                  │                │               │
 │               │                  │                │ Generate JWT token
 │               │                  │                │               │
 │               │◄──────────────────────────────────┤               │
 │               │ { accessToken: "eyJhbGci...",     │               │
 │               │   userId: "...", email: "..." }   │               │
 │               │                  │                │               │
 │               │ Store token      │                │               │
 │               │ Redirect to /dashboard            │               │
 │               │                  │                │               │
 │◄──────────────┤                  │                │               │
 │ ✓ Logged in!  │                  │                │               │
```

**Key Points**:
- Challenge is **single-use** (marked as `isUsed: true` after verification)
- Challenge has **5-minute expiration** (configurable)
- Signature verification uses **RSA-SHA256** algorithm
- Private key **never leaves the device**

---

## Data Formats

### 1. Public Key Format

**Storage in MongoDB**:
```
"MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA..." (base64, no headers)
```

**Usage in crypto.verify()**:
```typescript
const publicKeyPem = `-----BEGIN PUBLIC KEY-----
${publicKey}
-----END PUBLIC KEY-----`;
const publicKeyObject = createPublicKey(publicKeyPem);
```

### 2. Challenge Format

**Generation**:
```typescript
crypto.randomBytes(32).toString('base64url')
// Example: "7mzajR7JOxKFyMvJcxVYrjFt_5apmqgRwbNFOjcJPkQ"
```

**Signing on Mobile**:
```dart
final payload = Uint8List.fromList(utf8.encode(challenge));
final signature = await BiometricSignature().sign(
  payload: payload,
  androidSignatureAlgorithm: AndroidSignatureAlgorithm.SHA256withRSA,
);
final signatureBase64 = base64.encode(signature);
```

### 3. Signature Format

**Mobile Output**: Base64-encoded RSA signature
```
"hG3k9X2j... (344 characters, base64)"
```

**Backend Verification**:
```typescript
verify(
  'RSA-SHA256',
  Buffer.from(challenge, 'utf-8'),
  publicKeyObject,
  Buffer.from(signature, 'base64')
)
```

---

## Security Considerations

### 1. Multiple Credentials Support

As of the latest update, the backend **allows multiple biometric credentials per user**:

- **Use Case**: User can register biometric on multiple devices (e.g., mobile app, desktop WebAuthn)
- **Strategy**: Each credential is identified by its unique `publicKey`
- **No Overwriting**: Registration of a new credential does **NOT** deactivate or overwrite existing credentials
- **Device Independence**: Each device maintains its own key pair and can authenticate independently

**Important**: If a user registers biometric on the same device multiple times (e.g., re-enables biometric in mobile WebView), a **new credential is created** instead of updating the old one. This prevents cross-device conflicts where:
- User registers on mobile app → credential A
- User opens web dashboard in mobile WebView and enables biometric → credential B (different `publicKey`)
- Both credentials remain active, ensuring mobile app login continues to work

**Recommendation**: For production, consider implementing credential management UI where users can:
- View all registered devices
- Revoke specific credentials (set `isActive: false`)
- Set a maximum number of active credentials per user

### 2. State Verification for Multi-User Scenarios

When multiple users share the same device (common in testing environments), the device's local storage may contain biometric keys from different users. To prevent incorrect UI state:

**Problem**: User A enables biometric → logs out → User B logs in with password only
- Device still has User A's key in secure storage
- `BiometricBridge.keyExists()` returns `true`
- UI incorrectly shows "Disable Biometric Login" for User B

**Solution**: Backend verification endpoint
```typescript
// After password login (frontend)
const deviceHasKey = await BiometricBridge.keyExists();
const backendStatus = await biometricApi.checkNativeCredential(token);

// Only show "Disable" if BOTH conditions are true
const isRegistered = deviceHasKey.exists && backendStatus.hasCredential;
```

**Backend Implementation**:
- Endpoint: `POST /api/biometric/check`
- Query: Find active credential for `userId` with non-null `keyAlias`
- Returns: `{ hasCredential: boolean, keyAlias?: string }`

**When Called**:
- After successful password login (in `LoginPage.handleSubmit`)
- On dashboard mount (if user already authenticated)
- After biometric registration/unregistration

### 3. Challenge Replay Prevention

- Each challenge can only be used **once** (`isUsed` flag)
- Challenges **expire after 5 minutes**
- Old challenges are **not reusable** even if valid

### 4. Private Key Protection

- Private keys are **hardware-backed**:
  - Android: `setIsStrongBoxBacked(true)` → TEE/StrongBox
  - iOS: Secure Enclave
- Keys require **biometric authentication** for each use
- Keys are **bound to the device** (cannot be exported)

### 5. Public Key Storage

- Public keys stored in MongoDB are **read-only** after registration
- Each credential is tied to a specific `userId`
- Credentials can be marked **inactive** instead of deleted (audit trail)

### 6. Signature Algorithm

- **RSA-2048** with **SHA-256** hashing
- Industry-standard algorithm supported by both platforms
- Resistant to collision and pre-image attacks

---

## Dual-Mode Support: Native Biometric + WebAuthn

The backend now supports **both authentication methods**:

### Native Biometric (Mobile App)
```typescript
// Request format
{
  signature: "base64...",
  publicKey: "MIIBIj...",
  payload: "challenge_nonce"
}

// Backend auto-detects via presence of `publicKey` field
// Verification: crypto.verify('RSA-SHA256', ...)
```

### WebAuthn (Desktop Browser)
```typescript
// Request format
{
  credentialId: "base64url...",
  signature: "base64url...",
  authenticatorData: "base64url...",
  clientDataJSON: "base64url...",
  payload: "challenge_nonce"
}

// Backend auto-detects via presence of `credentialId` field
// Verification: WebAuthn assertion verification (ECDSA)
```

**Auto-detection logic** in `BiometricService.verifySignature()`:
```typescript
if (verifyDto.credentialId) {
  // WebAuthn format
  return this.verifyWebAuthnSignature(verifyDto);
} else if (verifyDto.publicKey) {
  // Native biometric format
  return this.verifyNativeBiometric(verifyDto);
}
```

This allows the same backend endpoint (`POST /api/biometric/verify`) to handle both mobile and desktop biometric authentication seamlessly.

---

## Troubleshooting

### Issue: "Biometric credential not found"

**Cause**: Public key mismatch or credential not registered.

**Solution**:
1. Check if credential exists in MongoDB: `db.biometriccredentials.find({ publicKey: "..." })`
2. Verify `publicKey` sent from frontend matches stored value
3. Ensure credential is `isActive: true`

### Issue: "Invalid biometric signature"

**Cause**: Signature verification failed.

**Possible reasons**:
1. **Public key format error**: Ensure PEM headers are added correctly
2. **Signature encoding mismatch**: Verify base64 encoding
3. **Algorithm mismatch**: Must use `RSA-SHA256` on both sides
4. **Challenge tampering**: Challenge sent to mobile ≠ challenge in verify request

**Debug steps**:
```typescript
// Backend logging
this.logger.debug(`Challenge: ${payload}`);
this.logger.debug(`Public key: ${publicKey.substring(0, 50)}...`);
this.logger.debug(`Signature length: ${signature.length}`);

// Verify key can be parsed
const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${publicKey}\n-----END PUBLIC KEY-----`;
const publicKeyObject = createPublicKey(publicKeyPem); // Should not throw
```

### Issue: "Challenge expired"

**Cause**: More than 5 minutes elapsed between challenge generation and verification.

**Solution**:
- Increase `challengeExpiresInSeconds` in backend config
- Or ensure login flow completes within 5 minutes

---

## Configuration

### Backend (NestJS)

**File**: `backend/src/config/configuration.ts`

```typescript
biometric: {
  challengeExpiresInSeconds: 300, // 5 minutes
}
```

### Mobile App (Flutter)

**File**: `mobile-app/lib/features/biometric/services/biometric_service.dart`

```dart
static const String defaultKeyAlias = 'biometrics_auth_default';
static const int rsaKeySize = 2048;
static const AndroidSignatureAlgorithm algorithm = 
    AndroidSignatureAlgorithm.SHA256withRSA;
```

### Frontend (Next.js)

**File**: `frontend/src/lib/api-client.ts`

```typescript
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api';
```

---

## Summary

✅ **Biometric registration**: User authenticates → Generate key pair → Store public key in backend  
✅ **Biometric login**: Backend generates challenge → Mobile signs with private key → Backend verifies signature → Issue JWT  
✅ **Dual-mode support**: Same backend handles native biometric (RSA) and WebAuthn (ECDSA)  
✅ **Security**: Hardware-backed keys, single-use challenges, 5-minute expiration  
✅ **Platform support**: Android (Keystore/StrongBox) + iOS (Secure Enclave)  

For more details on specific implementations, see:
- [Mobile ↔ Frontend Integration](./MOBILE_FRONTEND_INTEGRATION.md)
- [Frontend ↔ Backend Communication](./FRONTEND_BACKEND_COMMUNICATION.md)
- [WebAuthn Secure Context](./WEBAUTHN_SECURE_CONTEXT.md)
