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
│  └────────┬──────────┘    │  - setCurrentUser()         │ │
│           │               └─────────────────────────────┘ │
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
│  │                   │    │  State (native only):       │ │
│  │  - isNativeApp()  │    │  - canAuthenticate          │ │
│  │  - checkAvail..() │    │  - isRegistered             │ │
│  │  - createKeys()   │    │  - biometricType            │ │
│  │  - sign()         │    │  - availableBiometrics[]    │ │
│  │  - keyExists()    │    │  - loading (derived)        │ │
│  │  - getKeyInfo()   │    │                             │ │
│  │  - deleteKeys()   │    │  Methods:                   │ │
│  │  - deleteAllKeys()│    │  - enableBiometric(userId)  │ │
│  │  - simplePrompt() │    │  - loginWithBiometric()     │ │
│  │  - setCurrentUser │    │  - disableBiometric()       │ │
│  └──────────────────┘     │  - refreshStatus()          │ │
│                           │  - verifyRegistration       │ │
│                           │    WithBackend()            │ │
│  ┌───────────────────┐    └─────────────────────────────┘ │
│  │  BiometricIcon    │                                    │
│  │  getBiometricLabel│    ┌─────────────────────────────┐ │
│  │  getBiometricType │    │  Pages                      │ │
│  │  Name             │    │  - /login (4-state UI)      │ │
│  │  (lib/biometric-  │    │  - /dashboard (settings)    │ │
│  │   ui.tsx)         │    └─────────────────────────────┘ │
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
| 9 | `setCurrentUser` | `userId` | `setCurrentUser()` | Scope key operations to this user |
| 10 | `LogBridge.info` | `{message}` | Logger | Forward info log |
| 11 | `LogBridge.warn` | `{message}` | Logger | Forward warning log |
| 12 | `LogBridge.error` | `{message}` | Logger | Forward error log |
| 13 | `LogBridge.debug` | `{message}` | Logger | Forward debug log |

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

`window.flutter_inappwebview` is declared **optional** in
`frontend/src/types/flutter-inappwebview.d.ts` so TypeScript enforces the
check before any handler call. Accessing the bridge without a guard is a
compile-time error.

When `isNativeApp()` returns `true`, the frontend uses `BiometricBridge`
methods. When `false`, it falls back to the WebAuthn browser API.

---

## BiometricContext State

The `BiometricContext` (`contexts/biometric-context.tsx`) exposes the
following state fields. All fields except `isNativeApp` are only meaningful
when running inside the mobile WebView.

| Field | Type | Description |
|---|---|---|
| `isNativeApp` | `boolean` | `true` inside the Flutter WebView |
| `canAuthenticate` | `boolean` | Device has biometric hardware and it is enrolled |
| `isRegistered` | `boolean` | A key pair has been created and registered with the backend |
| `biometricType` | `string \| null` | Primary biometric type: `"fingerprint"`, `"face"`, `"iris"`, etc. |
| `availableBiometrics` | `string[]` | All biometric types reported by the device |
| `loading` | `boolean` | `true` while the initial bridge availability check is in progress |

### `loading` State Derivation

`loading` is derived as `nativeApp && !checkedOnce` — it requires no `setState`
call inside an effect body (which would violate React's linting rules). The
timeline in the WebView is:

```
SSR render:           nativeApp=false  checkedOnce=false  →  loading=false
Client hydration:     nativeApp=true   checkedOnce=false  →  loading=true  ← immediate
refreshStatus runs:   bridge responds  checkedOnce=true   →  loading=false
```

This ensures the login page sees `loading=true` immediately when the app
starts, preventing a flash where the biometric button is absent then suddenly
appears.

### `refreshStatus()` Contract

`refreshStatus()` is exposed from the context and is safe to call from any
component. It is a no-op when not in a native WebView. It is called:

1. **Automatically** — once on app startup via `BiometricProvider`'s effect.
2. **Explicitly** — by the login page on every mount, to reflect current device
   state (e.g. after the user enrolled biometrics on the Dashboard and returned
   to the login page).

### `verifyRegistrationWithBackend(token)` Contract

Cross-checks the local key against the backend credential to catch stale state
(e.g. credentials deleted directly from the DB by an admin).

**Native app**: calls `BiometricBridge.keyExists()` AND `biometricApi.checkNativeCredential(token)` in parallel.
`isRegistered` is set to `true` only when **both** return positive.

**Browser (WebAuthn)**: not called from the context; the Dashboard page handles
WebAuthn state sync directly by calling `biometricApi.checkNativeCredential(token)` on mount
and clearing `localStorage` if the backend no longer has the credential.

**When called**:
- Dashboard page — on mount, for both native and WebAuthn environments
- Login page — after successful password login (native only)

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
      │                  │ setCurrentUser      │                  │
      │                  │ (userId)            │                  │
      │                  ├────────────────────▶│                  │
      │                  │◀────────────────────┤                  │
      │                  │  {success: true}    │                  │
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

1. **Set Current User** — `BiometricBridge.setCurrentUser(userId)` calls the `setCurrentUser` handler. The native side persists the `userId` in secure storage so all subsequent key operations (create, sign, delete) are namespaced to this user. This is the first step to ensure key isolation when multiple users share the same device.

2. **Check Availability** — The frontend calls `BiometricBridge.checkAvailability()` which triggers the `biometricAuthAvailable` handler. The native side checks `local_auth` and returns `canAuthenticate`, `hasEnrolledBiometrics`, and `availableBiometrics`.

3. **Check Existing Keys** — `BiometricBridge.keyExists()` calls the `biometricKeyExists` handler. The native side checks the secure keystore (Android Keystore / iOS Keychain) for existing key pairs belonging to the current user.

4. **Delete Old Keys** (if they exist) — `BiometricBridge.deleteKeys()` removes stale credentials before creating new ones.

5. **Create Key Pair** — `BiometricBridge.createKeys()` triggers `biometricCreateKeys`, which:
   - Generates an ECDSA P-256 key pair in the secure hardware
   - Stores the private key under alias `biometrics_auth_{userId}` in Android Keystore / iOS Keychain
   - Returns the **public key** (Base64-encoded) and **key alias**

6. **Register with Backend** — The frontend sends `POST /biometric/register` with `{ userId, publicKey, keyAlias }`. The backend stores this credential in MongoDB for later verification.

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
      │                  │ setCurrentUser      │                  │
      │                  │ (verifyResult.      │                  │
      │                  │  userId)            │                  │
      │                  ├────────────────────▶│                  │
      │                  │◀────────────────────┤                  │
      │                  │                     │                  │
      │ store token in   │                     │                  │
      │ localStorage     │                     │                  │
      │ router.push      │                     │                  │
      │ ('/dashboard')   │                     │                  │
```

### Login Page Native Biometric Detection (4 States)

Before showing the biometric login button, the login page queries the bridge
and handles four distinct states:

| State | Condition | UI Shown |
|---|---|---|
| **Checking** | `isNative && loading` | Spinner: *"Checking biometric availability…"* |
| **Enrolled** | `isNative && !loading && canAuthenticate && isRegistered` | Biometric login button with `BiometricIcon` + type-specific label |
| **Not enrolled** | `isNative && !loading && canAuthenticate && !isRegistered` | Amber hint: *"X login is not set up. Enable from Dashboard → Biometric Settings."* |
| **Not available** | `isNative && !loading && !canAuthenticate` | Nothing — biometrics unavailable on this device |

```
Login page mounts (isNative=true)
│
├── useEffect: refreshStatus()  ← updates state, sets checkedOnce=true
│
├── loading=true  →  show spinner
│
└── loading=false
       ├── canAuthenticate=true, isRegistered=true  →  show button
       ├── canAuthenticate=true, isRegistered=false →  show amber hint
       └── canAuthenticate=false                   →  show nothing
```

The button label and icon adapt to `biometricType` using helpers from
`lib/biometric-ui.tsx` (see [Biometric UI Helpers](#biometric-ui-helpers)).

---

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

4. **Sync User Context** — After a successful verify, `BiometricBridge.setCurrentUser(userId)` is called with the confirmed `userId` from the backend response. This ensures subsequent biometric operations (e.g. disable from the Dashboard) use the correct user-scoped key.

5. **Store Token & Navigate** — The frontend stores the JWT access token in `localStorage` and redirects to the Dashboard.

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

## Biometric UI Helpers

`frontend/src/lib/biometric-ui.tsx` maps a biometric type string (from the
bridge) to an SVG icon and a human-readable label. Both the login page and the
dashboard import these helpers.

### `BiometricIcon`

```tsx
<BiometricIcon type={biometricType} className="w-5 h-5" />
```

| `type` value | Icon rendered |
|---|---|
| `"fingerprint"`, `"strong"`, `"weak"`, `null` | Fingerprint spiral (default) |
| `"face"` | Smiling face circle (Face ID style) |
| `"iris"` | Eye outline |

### `getBiometricLabel(type, action)`

```ts
getBiometricLabel("face", "login")    // → "Face ID Login"
getBiometricLabel("fingerprint", "enable")  // → "Enable Fingerprint Login"
getBiometricLabel(null, "disable")    // → "Disable Biometric Login"
```

`action` is one of `"login"` | `"enable"` | `"disable"`.

### `getBiometricTypeName(type)`

```ts
getBiometricTypeName("face")         // → "Face ID"
getBiometricTypeName("fingerprint")  // → "Fingerprint"
getBiometricTypeName("iris")         // → "Iris"
getBiometricTypeName(null)           // → "Biometric"
```

---

## TypeScript ↔ Dart Type Mapping

The following table shows how TypeScript interfaces in the frontend map to Dart return types from the mobile app:

| TypeScript Interface | Dart Method Return | Key Fields |
|---|---|---|
| `BiometricAvailability` | `checkAvailability()` → `Map<String, dynamic>` | `success`, `canAuthenticate`, `hasEnrolledBiometrics`, `availableBiometrics` (non-null `string[]`) |
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
| `frontend/src/types/flutter-inappwebview.d.ts` | TypeScript declarations for `window.flutter_inappwebview?` (optional) |
| `frontend/src/lib/biometric-bridge.ts` | Typed API for calling native JS bridge handlers, including `setCurrentUser` |
| `frontend/src/lib/api-client.ts` | Fetch wrapper; exports `ApiError` (carries HTTP `status`) for typed 404 handling |
| `frontend/src/lib/biometric-ui.tsx` | `BiometricIcon`, `getBiometricLabel`, `getBiometricTypeName` UI helpers |
| `frontend/src/contexts/biometric-context.tsx` | React context: state + `refreshStatus` / `enableBiometric` / `loginWithBiometric` / `disableBiometric` / `verifyRegistrationWithBackend` |
| `frontend/src/app/login/page.tsx` | Login UI — 4-state native WebView path + WebAuthn path; clears stale localStorage on 404 |
| `frontend/src/app/dashboard/page.tsx` | Dashboard with biometric credential management; syncs backend state on mount |
| `frontend/src/app/layout.tsx` | Root layout wrapping app with `BiometricProvider` |

### Backend (NestJS)

| Endpoint | Method | Purpose |
|---|---|---|
| `/biometric/register` | POST | Store public key credential for a user |
| `/biometric/challenge` | POST | Generate server challenge nonce |
| `/biometric/verify` | POST | Verify ECDSA signature, return JWT |
| `/biometric/unregister` | **POST** | Remove biometric credential (requires JWT) |

> **Note:** The unregister endpoint uses `POST`, not `DELETE`. The `@Post`
> decorator is used in `BiometricController` because the route requires a
> request body (`publicKey?`) for selective credential removal.

---

## Fallback Behavior

When the frontend detects it is **not** running inside the mobile WebView (`isNativeApp() === false`), it falls back to the **WebAuthn browser API**.

> **Note:** WebAuthn requires a Secure Context (HTTPS or `localhost`). If the
> frontend is accessed over plain HTTP from a non-localhost origin the browser
> will hide `window.PublicKeyCredential` and biometric detection will return
> false. See [WebAuthn Secure Context](./WEBAUTHN_SECURE_CONTEXT.md).

| Feature | Native (Mobile WebView) | WebAuthn (Desktop Browser) |
|---|---|---|
| Detection | `isNativeApp() === true` → query bridge via `refreshStatus()` | `isWebAuthnSupported() === true` (synchronous, `useSyncExternalStore`) |
| Key storage | Android Keystore / iOS Keychain | Browser platform authenticator |
| API layer | `BiometricBridge.*` | `navigator.credentials.create()` / `.get()` |
| Prompt | Native biometric dialog | Browser biometric dialog |
| Backend flow | Same (register → challenge → sign → verify) | Same endpoints |
| Biometric type | From `availableBiometrics[]` via bridge | Not exposed by browser API |
| UI icon/label | Dynamic: `BiometricIcon` + `getBiometricLabel` | Static: fingerprint icon + "WebAuthn Login" |
| Loading state | `loading=true` while bridge query in progress | No loading state needed (synchronous) |

---

## Security Considerations

1. **Private keys never leave the device** — Only public keys are sent to the backend. Private keys are stored in secure hardware (Android Keystore / iOS Keychain) and require biometric authentication to access.

2. **Challenge-response pattern** — The backend generates a one-time challenge with a 60-second TTL. This prevents replay attacks.

3. **ECDSA-SHA256 signatures** — The digital signature proves possession of the private key without revealing it.

4. **JWT tokens** — Successful verification returns a signed JWT with 24-hour expiration for subsequent API calls.