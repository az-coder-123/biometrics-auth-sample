# Mobile App ↔ Frontend Integration Guide

## Overview

This document describes the communication architecture between the **Flutter mobile app** and the **Next.js frontend** when running inside the mobile WebView. The frontend operates as a web application loaded within the InAppWebView Flutter plugin, and communicates with native device capabilities through a JavaScript bridge.

---

## Architecture Diagram

```
┌───────────────────────────────────────────────────────────┐
│                    Mobile App (Flutter)                   │
│                                                           │
│  ┌───────────────────┐    ┌─────────────────────────────┐ │
│  │  InAppWebView     │    │  BiometricService           │ │
│  │  Controller       │    │  - checkAvailability()      │ │
│  │                   │    │  - createKeyPair()          │ │
│  └────────┬──────────┘    │  - signPayload()            │ │
│           │               │  - keyExists()              │ │
│  ┌────────▼──────────┐    │  - getKeyInfo()             │ │
│  │  JsBridgeService  │───▶  - deleteKeys()              │ │
│  │  (registers JS    │    │  - deleteAllKeys()          │ │
│  │   handlers)       │    │  - simplePrompt()           │ │
│  └────────┬──────────┘    └─────────────────────────────┘ │
│           │ JS Bridge                                     │
└───────────┼───────────────────────────────────────────────┘
            │ window.flutter_inappwebview.callHandler()
┌───────────┼───────────────────────────────────────────────┐
│           ▼       Frontend (Next.js in WebView)           │
│                                                           │
│  ┌───────────────────┐    ┌─────────────────────────────┐ │
│  │  BiometricBridge  │    │  BiometricContext           │ │
│  │  (lib/            │    │  (contexts/                 │ │
│  │   biometric-      │    │   biometric-context.tsx)    │ │
│  │   bridge.ts)      │    │                             │ │
│  │                   │    │  - enableBiometric(userId)  │ │
│  │  - isNativeApp()  │    │  - loginWithBiometric()     │ │
│  │  - checkAvail..() │    │  - disableBiometric()       │ │
│  │  - createKeys()   │    └─────────────────────────────┘ │
│  │  - sign()         │                                    │
│  │  - keyExists()    │    ┌─────────────────────────────┐ │
│  │  - getKeyInfo()   │    │  Pages                      │ │
│  │  - deleteKeys()   │    │  - /login (biometric btn)   │ │
│  │  - deleteAllKeys()│    │  - /dashboard (settings)    │ │
│  │  - simplePrompt() │    └─────────────────────────────┘ │
│  └──────────────────┘                                     │
└───────────────────────────────────────────────────────────┘
            │ HTTP API
            ▼
┌───────────────────────────────────────────────────────────┐
│                Backend (NestJS + MongoDB)                 │
│                                                           │
│  POST /biometric/register   — Store public key            │
│  POST /biometric/challenge  — Generate challenge nonce    │
│  POST /biometric/verify     — Verify signature → JWT      │
│  DELETE /biometric/unregister — Remove credential         │
└───────────────────────────────────────────────────────────┘
```

---

## Communication Layer: JavaScript Bridge

### How It Works

The Flutter `flutter_inappwebview` plugin injects a `window.flutter_inappwebview` object into the WebView's JavaScript context. The mobile app's `JsBridgeService` registers named handlers on this object. The frontend calls these handlers via `window.flutter_inappwebview.callHandler(handlerName, ...args)`.

```
Frontend (JS)                          Mobile App (Dart)
─────────────                          ─────────────────
callHandler('biometricSign',   ────▶   handler callback receives
  payload, alias, reason)              args = [payload, alias, reason]
                                       │
                                       ▼
                                       BiometricService.signPayload()
                                       │
                                       ◀──── returns Map result
                                       │
callHandler promise resolves   ◀─────── handler returns value
```

### Handler Registry

The `JsBridgeService` registers the following handlers on the `InAppWebViewController`:

| # | Handler Name | JS Arguments | Native Method | Purpose |
|---|---|---|---|---|
| 1 | `biometricAuthAvailable` | _(none)_ | `checkAvailability()` | Check if device supports biometrics |
| 2 | `biometricCreateKeys` | `keyAlias?`, `reason?` | `createKeyPair()` | Create hardware-backed key pair |
| 3 | `biometricSign` | `payload`, `keyAlias?`, `reason?` | `signPayload()` | Sign a challenge with biometric |
| 4 | `biometricKeyExists` | `keyAlias?` | `keyExists()` | Check if keys are stored |
| 5 | `biometricGetKeyInfo` | `keyAlias?` | `getKeyInfo()` | Get key details |
| 6 | `biometricDeleteKeys` | `keyAlias?` | `deleteKeys()` | Delete specific key |
| 7 | `biometricDeleteAllKeys` | _(none)_ | `deleteAllKeys()` | Delete all keys |
| 8 | `biometricSimplePrompt` | `message`, `reason?` | `simplePrompt()` | Prompt without crypto |
| 9 | `LogBridge.info` | `{message}` | Logger | Forward info log |
| 10 | `LogBridge.warn` | `{message}` | Logger | Forward warning log |
| 11 | `LogBridge.error` | `{message}` | Logger | Forward error log |
| 12 | `LogBridge.debug` | `{message}` | Logger | Forward debug log |

---

## Frontend Detection

The frontend must detect whether it is running inside the mobile WebView to enable native biometric features. This is handled by the `isNativeApp()` function:

```typescript
// frontend/src/lib/biometric-bridge.ts
export function isNativeApp(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.flutter_inappwebview !== "undefined"
  );
}
```

When `isNativeApp()` returns `true`, the frontend uses `BiometricBridge` methods. When `false`, it falls back to the WebAuthn browser API (for desktop browsers).

---

## Data Flow: Biometric Registration

This flow registers a new biometric credential for the currently authenticated user. It is triggered from the **Dashboard** page when the user taps "Enable Biometric Login".

```
┌───────────┐     ┌──────────────┐      ┌──────────────┐     ┌─────────┐
│ Dashboard │     │ BiometricCtx │      │BioBridge/JS  │     │ Backend │
│  Page     │     │  Provider    │      │ Bridge→Native│     │  API    │
└─────┬─────┘     └──────┬───────┘      └──────┬───────┘     └────┬────┘
      │                  │                     │                  │
      │ enableBiometric  │                     │                  │
      │ (userId)         │                     │                  │
      ├─────────────────▶│                     │                  │
      │                  │                     │                  │
      │                  │ checkAvailability() │                  │
      │                  ├────────────────────▶│                  │
      │                  │◀────────────────────┤                  │
      │                  │  {canAuthenticate}  │                  │
      │                  │                     │                  │
      │                  │ keyExists()         │                  │
      │                  ├────────────────────▶│                  │
      │                  │◀────────────────────┤                  │
      │                  │  {exists: bool}     │                  │
      │                  │                     │                  │
      │                  │ [if exists]         │                  │
      │                  │ deleteKeys()        │                  │
      │                  ├────────────────────▶│                  │
      │                  │◀────────────────────┤                  │
      │                  │                     │                  │
      │                  │ createKeys(null,    │                  │
      │                  │  "Authenticate to   │                  │
      │                  │   enable biometric  │                  │
      │                  │   login")           │                  │
      │                  ├────────────────────▶│                  │
      │                  │                     │ 🖐️ Biometric
      │                  │                     │    Prompt
      │                  │◀────────────────────┤                  │
      │                  │ {success, publicKey,│                  │
      │                  │  keyAlias}          │                  │
      │                  │                     │                  │
      │                  │ POST /biometric/register               │
      │                  │ {userId, publicKey, keyAlias}          │
      │                  ├───────────────────────────────────────▶│
      │                  │◀───────────────────────────────────────┤
      │                  │ {message, credential}                  │
      │                  │                     │                  │
      │◀─────────────────┤                     │                  │
      │ {success: true}  │                     │                  │
```

### Step-by-Step

1. **Check Availability** — The frontend calls `BiometricBridge.checkAvailability()` which triggers the `biometricAuthAvailable` handler. The native side checks `local_auth` and returns `canAuthenticate`, `hasEnrolledBiometrics`, and `availableBiometrics`.

2. **Check Existing Keys** — `BiometricBridge.keyExists()` calls the `biometricKeyExists` handler. The native side checks the secure keystore (Android Keystore / iOS Keychain) for existing key pairs.

3. **Delete Old Keys** (if they exist) — `BiometricBridge.deleteKeys()` removes stale credentials before creating new ones.

4. **Create Key Pair** — `BiometricBridge.createKeys()` triggers `biometricCreateKeys`, which:
   - Generates an ECDSA P-256 key pair in the secure hardware
   - Stores the private key in Android Keystore / iOS Keychain (requires biometric to access)
   - Returns the **public key** (Base64-encoded) and **key alias**

5. **Register with Backend** — The frontend sends `POST /biometric/register` with `{ userId, publicKey, keyAlias }`. The backend stores this credential in MongoDB for later verification.

---

## Data Flow: Biometric Authentication (Login)

This flow authenticates a user without a password, using only their biometric credential. It is triggered from the **Login** page when the user taps the biometric button.

```
┌───────────┐     ┌──────────────┐      ┌──────────────┐     ┌─────────┐
│  Login    │     │ BiometricCtx │      │BioBridge/JS  │     │ Backend │
│  Page     │     │  Provider    │      │ Bridge→Native│     │  API    │
└─────┬─────┘     └──────┬───────┘      └──────┬───────┘     └────┬────┘
      │                  │                     │                  │
      │ loginWithBio     │                     │                  │
      │ metric()         │                     │                  │
      ├─────────────────▶│                     │                  │
      │                  │                     │                  │
      │                  │ POST /biometric/challenge              │
      │                  ├───────────────────────────────────────▶│
      │                  │◀───────────────────────────────────────┤
      │                  │ {challenge: "random-nonce"}            │
      │                  │                     │                  │
      │                  │ sign(challenge,     │                  │
      │                  │   null,             │                  │
      │                  │   "Authenticate to  │                  │
      │                  │    login")          │                  │
      │                  ├────────────────────▶│                  │
      │                  │                     │ 🖐️ Biometric
      │                  │                     │    Prompt
      │                  │◀────────────────────┤                  │
      │                  │ {success, signature,│                  │
      │                  │  publicKey, payload}│                  │
      │                  │                     │                  │
      │                  │ POST /biometric/verify                 │
      │                  │ {signature, publicKey, payload}        │
      │                  ├───────────────────────────────────────▶│
      │                  │                     │ crypto.verify()
      │                  │                     │ (ECDSA-SHA256)
      │                  │◀───────────────────────────────────────┤
      │                  │ {accessToken, userId, email}           │
      │                  │                     │                  │
      │◀─────────────────┤                     │                  │
      │ {success,        │                     │                  │
      │  accessToken}    │                     │                  │
      │                  │                     │                  │
      │ store token in   │                     │                  │
      │ localStorage     │                     │                  │
      │ router.push      │                     │                  │
      │ ('/dashboard')   │                     │                  │
```

### Step-by-Step

1. **Generate Challenge** — The frontend calls `POST /biometric/challenge` on the backend. The backend generates a cryptographically random nonce (stored in MongoDB with 60s TTL) and returns it as `{ challenge: "..." }`.

2. **Sign with Biometric** — The frontend calls `BiometricBridge.sign(challenge)` which triggers the `biometricSign` handler. The native side:
   - Shows a biometric prompt (fingerprint / face recognition)
   - Retrieves the private key from secure hardware (requires biometric unlock)
   - Signs the challenge with ECDSA-SHA256
   - Returns `{ signature, publicKey, payload }` (all Base64-encoded)

3. **Verify Signature** — The frontend sends `POST /biometric/verify` with `{ signature, publicKey, payload }`. The backend:
   - Looks up the stored public key from the `BiometricCredential` collection
   - Verifies the ECDSA-SHA256 signature using `crypto.verify()`
   - Validates the challenge matches and hasn't expired
   - Returns `{ accessToken, userId, email }` on success

4. **Store Token & Navigate** — The frontend stores the JWT access token in `localStorage` and redirects to the Dashboard.

---

## Data Flow: Biometric Unregistration

This flow removes biometric credentials from both the device and the backend. It is triggered from the **Dashboard** when the user taps "Disable Biometric Login".

```
┌───────────┐     ┌──────────────┐      ┌──────────────┐     ┌─────────┐
│ Dashboard │     │ BiometricCtx │      │BioBridge/JS  │     │ Backend │
│  Page     │     │  Provider    │      │ Bridge→Native│     │  API    │
└─────┬─────┘     └──────┬───────┘      └──────┬───────┘     └────┬────┘
      │                  │                     │                  │
      │ disableBio       │                     │                  │
      │ metric()         │                     │                  │
      ├─────────────────▶│                     │                  │
      │                  │                     │                  │
      │                  │ deleteKeys()        │                  │
      │                  ├────────────────────▶│                  │
      │                  │                     │ Removes keys from
      │                  │                     │ Android Keystore /
      │                  │                     │ iOS Keychain
      │                  │◀────────────────────┤                  │
      │                  │ {success: true}     │                  │
      │                  │                     │                  │
      │                  │ DELETE /biometric/unregister           │
      │                  ├───────────────────────────────────────▶│
      │                  │                     │ Removes from
      │                  │                     │ MongoDB
      │                  │◀───────────────────────────────────────┤
      │                  │ {message}           │                  │
      │                  │                     │                  │
      │◀─────────────────┤                     │                  │
      │ (complete)       │                     │                  │
```

---

## TypeScript ↔ Dart Type Mapping

The following table shows how TypeScript interfaces in the frontend map to Dart return types from the mobile app:

| TypeScript Interface | Dart Method Return | Key Fields |
|---|---|---|
| `BiometricAvailability` | `checkAvailability()` → `Map<String, dynamic>` | `success`, `canAuthenticate`, `hasEnrolledBiometrics`, `availableBiometrics` |
| `CreateKeysResult` | `createKeyPair()` → `Map<String, dynamic>` | `success`, `publicKey` (Base64), `keyAlias` |
| `SignResult` | `signPayload()` → `Map<String, dynamic>` | `success`, `authenticated`, `signature` (Base64), `publicKey` (Base64), `payload` |
| `KeyExistsResult` | `keyExists()` → `Map<String, dynamic>` | `exists`, `keyAlias`, `valid` |
| `KeyInfoResult` | `getKeyInfo()` → `Map<String, dynamic>` | `exists`, `keyAlias`, `valid`, `publicKey` |
| `SimplePromptResult` | `simplePrompt()` → `Map<String, dynamic>` | `success`, `authenticated` |

### Key Encoding

- **Public keys** are Base64-encoded DER representations of ECDSA P-256 public keys
- **Signatures** are Base64-encoded raw ECDSA signatures
- **Challenges** are UTF-8 strings generated by the backend

---

## File Reference

### Mobile App (Dart)

| File | Responsibility |
|---|---|
| `mobile-app/lib/features/biometric/services/biometric_service.dart` | Platform biometric operations via `local_auth` + secure key management |
| `mobile-app/lib/features/webview/services/js_bridge_service.dart` | Registers JS handlers, maps bridge calls to `BiometricService` methods |

### Frontend (TypeScript/React)

| File | Responsibility |
|---|---|
| `frontend/src/types/flutter-inappwebview.d.ts` | TypeScript declarations for `window.flutter_inappwebview` |
| `frontend/src/lib/biometric-bridge.ts` | Typed API for calling native JS bridge handlers |
| `frontend/src/contexts/biometric-context.tsx` | React context managing biometric state and flows |
| `frontend/src/app/login/page.tsx` | Login UI with native biometric + WebAuthn support |
| `frontend/src/app/dashboard/page.tsx` | Dashboard with biometric credential management |
| `frontend/src/app/layout.tsx` | Root layout wrapping app with `BiometricProvider` |

### Backend (NestJS)

| Endpoint | Method | Purpose |
|---|---|---|
| `/biometric/register` | POST | Store public key credential for a user |
| `/biometric/challenge` | POST | Generate server challenge nonce |
| `/biometric/verify` | POST | Verify ECDSA signature, return JWT |
| `/biometric/unregister` | DELETE | Remove biometric credential |

---

## Fallback Behavior

When the frontend detects it is **not** running inside the mobile WebView (`isNativeApp() === false`), it falls back to the **WebAuthn browser API**:

| Feature | Native (Mobile WebView) | WebAuthn (Desktop Browser) |
|---|---|---|
| Detection | `isNativeApp() === true` | `isPlatformAuthenticatorAvailable() === true` |
| Key storage | Android Keystore / iOS Keychain | Browser platform authenticator |
| API layer | `BiometricBridge.*` | `navigator.credentials.create()` / `.get()` |
| Prompt | Native biometric dialog | Browser biometric dialog |
| Backend flow | Same (register → challenge → sign → verify) | Same endpoints |

---

## Security Considerations

1. **Private keys never leave the device** — Only public keys are sent to the backend. Private keys are stored in secure hardware (Android Keystore / iOS Keychain) and require biometric authentication to access.

2. **Challenge-response pattern** — The backend generates a one-time challenge with a 60-second TTL. This prevents replay attacks.

3. **ECDSA-SHA256 signatures** — The digital signature proves possession of the private key without revealing it.

4. **JWT tokens** — Successful verification returns a signed JWT with 24-hour expiration for subsequent API calls.