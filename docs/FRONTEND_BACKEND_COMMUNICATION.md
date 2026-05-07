# Frontend–Backend Communication Guide

This document describes how the **Next.js frontend** and **NestJS backend**
communicate during the authentication and biometric enrollment flows.

> **Note:** The frontend supports two biometric modes:
> - **WebAuthn** — when running in a desktop browser with platform authenticator
> - **Native Biometric** — when running inside the Flutter mobile app WebView
>   (see [Mobile ↔ Frontend Integration](./MOBILE_FRONTEND_INTEGRATION.md))

> **Important:** WebAuthn only works in a **Secure Context** (HTTPS or
> `localhost`). Accessing the frontend via a plain HTTP IP address (e.g.
> `http://192.168.1.11:3001`) will cause the browser to hide the
> `window.PublicKeyCredential` API, making biometric detection always return
> false. See [WebAuthn Secure Context](./WEBAUTHN_SECURE_CONTEXT.md) for the
> full explanation and development HTTPS setup options.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [API Reference](#api-reference)
3. [Authentication Flow](#authentication-flow)
4. [Biometric Registration Flow](#biometric-registration-flow)
5. [Biometric Login Flow](#biometric-login-flow)
6. [Sequence Diagrams](#sequence-diagrams)
7. [Error Handling](#error-handling)
8. [Configuration](#configuration)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                        │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Detection Layer                          │ │
│  │  isNativeApp()? ──┬── YES → BiometricBridge (JS Bridge)     │ │
│  │                   └── NO  → WebAuthn (Browser API)          │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌──────────────────┐  ┌────────────────┐  ┌────────────────┐    │
│  │ Auth Context     │  │ BiometricCtx   │  │ API Client     │    │
│  │ (React State)    │  │ (React State)  │  │ (fetch wrapper)│    │
│  └──────────────────┘  └────────────────┘  └────────────────┘    │
└──────────────────────────┬───────────────────────────────────────┘
                           │
           ┌───────────────┼───────────────┐
           │ JS Bridge     │               │ HTTP/REST
           │ (native only) │               │
           ▼               │               ▼
┌──────────────────────┐   │   ┌──────────────────────────────────┐
│  Mobile App (Flutter)│   │   │  Backend (NestJS)                │
│  JsBridgeService     │   │   │                                  │
│  BiometricService    │   │   │  ┌────────────────┐              │
│  (Android Keystore / │   │   │  │ Auth Module    │              │
│   iOS Keychain)      │   │   │  │ Biometric Mod. │              │
└──────────────────────┘   │   │  │ JWT Guard      │              │
                           │   │  └────────────────┘              │
                           │   │  ┌────────────────┐              │
                           │   │  │ MongoDB        │              │
                           │   │  │ (Collections)  │              │
                           │   │  └────────────────┘              │
                           │   └──────────────────────────────────┘
                           │
                   ┌───────┴────────┐
                   │ WebAuthn API   │
                   │ (Browser)      │
                   │ TPM / Secure   │
                   │ Enclave        │
                   └────────────────┘
```

### Technology Stack

| Layer      | Frontend                                          | Backend                    |
|------------|---------------------------------------------------|----------------------------|
| Framework  | Next.js 16 (React 19)                             | NestJS 11                  |
| Auth       | WebAuthn + BiometricBridge (native) + JWT         | Passport JWT + bcrypt      |
| Biometric  | `navigator.credentials` / `window.flutter_...`    | RSA-SHA256 (native) + ECDSA-SHA256 (WebAuthn) |
| Styling    | Tailwind CSS                                      | N/A                        |
| Database   | N/A                                               | MongoDB (Mongoose)         |
| Port       | 3001                                              | 3000                       |

---

## API Reference

All backend endpoints are prefixed with `/api`. The frontend communicates
via JSON request/response bodies.

### Auth Endpoints

#### `POST /api/auth/register`

Register a new user account.

| Field     | Type   | Required | Description                     |
|-----------|--------|----------|---------------------------------|
| `email`   | string | ✓        | Valid email address             |
| `password`| string | ✓        | Min 8 characters                |
| `fullName`| string | ✓        | User's full name                |

**Response (201):**

```json
{
  "message": "User registered successfully",
  "user": {
    "_id": "682a...",
    "email": "user@example.com",
    "fullName": "John Doe",
    "isActive": true,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  }
}
```

---

#### `POST /api/auth/login`

Authenticate with email and password. Returns a JWT access token.

| Field      | Type   | Required | Description          |
|------------|--------|----------|----------------------|
| `email`    | string | ✓        | Valid email address  |
| `password` | string | ✓        | User's password      |

**Response (200):**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "userId": "682a...",
  "email": "user@example.com"
}
```

---

#### `GET /api/auth/profile`

Returns the authenticated user's profile.

| Header          | Value                    |
|-----------------|--------------------------|
| `Authorization` | `Bearer <access_token>`  |

**Response (200):**

```json
{
  "userId": "682a...",
  "email": "user@example.com"
}
```

---

### Biometric Endpoints

#### `POST /api/biometric/register`

Stores a biometric credential (public key) for a user.
Used by both WebAuthn and native biometric flows.

| Field       | Type   | Required | Description                           |
|-------------|--------|----------|---------------------------------------|
| `userId`    | string | ✓        | MongoDB user `_id`                    |
| `publicKey` | string | ✓        | Base64-encoded public key             |
| `keyAlias`  | string |          | Key alias or credential ID            |

**Response (201):**

```json
{
  "message": "Biometric credential registered successfully",
  "credential": {
    "id": "682a...",
    "publicKey": "pAEBA...base64",
    "keyAlias": "a1B2c3...base64",
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
}
```

---

#### `POST /api/biometric/challenge`

Generates a one-time challenge nonce for biometric authentication.
No request body required.

**Response (200):**

```json
{
  "challenge": "dGhpcyBpcyBhIHJhbmRvb...base64"
}
```

> The challenge is a cryptographically random value. It expires after
> 60 seconds (configurable via `BIOMETRIC_CHALLENGE_EXPIRY`).

---

#### `POST /api/biometric/check`

Checks if the authenticated user has a native biometric credential registered.
Used for state synchronization in multi-user scenarios on the same device.

| Header          | Value                    |
|-----------------|--------------------------||
| `Authorization` | `Bearer <access_token>`  |

**Response (200):**

```json
{
  "hasCredential": true,
  "keyAlias": "biometrics_auth_default"
}
```

> **Use Case**: When multiple users share the same device, the device may have
> biometric keys from a previous user stored locally. This endpoint verifies
> whether the **currently logged-in user** owns a credential in the backend,
> ensuring the UI displays the correct registration state.
>
> **Frontend Usage**: Called after password login to sync `isRegistered` state:
> ```typescript
> const deviceHasKey = await BiometricBridge.keyExists();
> const backendStatus = await biometricApi.checkNativeCredential(token);
> const isRegistered = deviceHasKey.exists && backendStatus.hasCredential;
> ```

---

#### `POST /api/biometric/verify`

Verifies a biometric signature and returns a JWT token.
Supports two verification methods:

**Native Biometric** (from mobile WebView):

| Field       | Type   | Required | Description                         |
|-------------|--------|----------|-------------------------------------|
| `signature` | string | ✓        | Base64-encoded RSA signature        |
| `publicKey` | string | ✓        | Base64-encoded public key           |
| `payload`   | string | ✓        | The original challenge nonce        |

**WebAuthn** (from desktop browser):

| Field              | Type   | Required | Description                              |
|--------------------|--------|----------|------------------------------------------|
| `credentialId`     | string | ✓        | Base64url credential ID                  |
| `signature`        | string | ✓        | Base64url assertion signature            |
| `authenticatorData`| string | ✓        | Base64url authenticator data             |
| `clientDataJSON`   | string | ✓        | Base64url client data JSON               |
| `payload`          | string | ✓        | The original challenge nonce             |

**Response (200):**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "userId": "682a...",
  "email": "user@example.com"
}
```

> **Backend Auto-Detection**: The backend automatically detects which verification
> method to use based on the request fields:
> - If `credentialId` is present → **WebAuthn verification** (ECDSA signature)
> - If `publicKey` is present → **Native biometric verification** (RSA-SHA256 signature)
>
> This allows the same endpoint to handle both mobile and desktop biometric authentication
> seamlessly. See [Biometric Authentication Flow](./BIOMETRIC_AUTHENTICATION_FLOW.md) for
> detailed flow diagrams.

---

#### `POST /api/biometric/unregister`

Removes biometric credential(s) for the authenticated user.

| Header          | Value                    |
|-----------------|--------------------------|
| `Authorization` | `Bearer <access_token>`  |

| Field       | Type   | Required | Description                      |
|-------------|--------|----------|----------------------------------|
| `publicKey` | string |          | Specific key to remove           |

**Response (200):**

```json
{
  "message": "Biometric credential unregistered successfully"
}
```

---

## Authentication Flow

The standard email/password login flow:

```
┌──────────┐                              ┌──────────┐
│  Browser │                              │  Server  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │  1. User enters email + password        │
     │                                         │
     │  POST /api/auth/login ─────────────────►│
     │  { email, password }                    │
     │                                         │
     │                     2. Validate creds   │
     │                        bcrypt.compare   │
     │                        Generate JWT     │
     │                                         │
     │  ◄─────────────── { accessToken, ... }  │
     │                                         │
     │  3. Store token in localStorage         │
     │     Update AuthContext state            │
     │                                         │
     │  4. Redirect to /dashboard              │
     │                                         │
```

### Frontend Implementation

The `AuthContext` (`src/contexts/auth-context.tsx`) manages authentication state:

- **`login(credentials)`** — Calls `POST /api/auth/login`, stores the JWT token
  in localStorage, and updates React context state.
- **`register(data)`** — Calls `POST /api/auth/register`, then auto-login.
- **`logout()`** — Clears localStorage and resets context state.
- **`isAuthenticated`** — Derived from presence of stored access token.

The `api-client.ts` module provides typed wrapper functions for all API calls:

```typescript
// Example: login call
const response = await fetch(`${API_URL}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
```

---

## Biometric Registration Flow

This flow enrolls a user's biometric credential (fingerprint/face) for
passwordless authentication. There are two variants depending on the
runtime environment.

### Prerequisites (both flows)

- User must be logged in (JWT token available)
- Biometric hardware must be available on the device

---

### Variant A: WebAuthn (Desktop Browser)

#### Prerequisites

- Browser must support WebAuthn
- Platform authenticator (biometric hardware) must be available

#### Steps

```
┌──────────┐                              ┌──────────┐
│  Browser │                              │  Server  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │  1. Check biometric availability        │
     │     isPlatformAuthenticatorAvailable()  │
     │                                         │
     │  2. Generate local challenge            │
     │     generateRandomBuffer(32)            │
     │                                         │
     │  3. Call WebAuthn create credential     │
     │     navigator.credentials.create({      │
     │       publicKey: {                      │
     │         challenge,                      │
     │         rp: { name },                   │
     │         user: { id, name },             │
     │         pubKeyCredParams: [ES256],      │
     │         authenticatorSelection: {       │
     │           platform + userVerification   │
     │         }                               │
     │       }                                 │
     │     })                                  │
     │                                         │
     │  ┌──────────────────────────────────┐   │
     │  │ OS prompts for fingerprint/face  │   │
     │  │ Hardware generates key pair      │   │
     │  │ Returns: rawId, publicKey, ...   │   │
     │  └──────────────────────────────────┘   │
     │                                         │
     │  4. POST /api/biometric/register ──────►│
     │  { userId, publicKey, keyAlias }        │
     │                                         │
     │                   5. Store in MongoDB   │
     │                      { userId,          │
     │                        publicKey,       │
     │                        keyAlias,        │
     │                        isActive }       │
     │                                         │
     │  ◄──── { message, credential }          │
     │                                         │
     │  6. Store credentialId in localStorage  │
     │     for future biometric login          │
     │                                         │
```

#### Frontend Storage

After successful registration, the credential ID is stored in localStorage
keyed by user email:

```typescript
const STORAGE_KEY = `biometrics_cred_ids_${email}`;
localStorage.setItem(STORAGE_KEY, JSON.stringify([credentialId]));
```

---

### Variant B: Native Biometric (Mobile WebView)

#### Prerequisites

- Frontend must be running inside the mobile app WebView (`isNativeApp() === true`)
- Device must support biometric authentication

#### Steps

```
┌───────────┐     ┌──────────────┐      ┌──────────────┐     ┌─────────┐
│ Dashboard │     │ BiometricCtx │      │BioBridge→JS  │     │ Backend │
│  Page     │     │  Provider    │      │  → Native    │     │  API    │
└─────┬─────┘     └──────┬───────┘      └──────┬───────┘     └────┬────┘
      │                  │                     │                  │
      │ enableBiometric  │                     │                  │
      │ (userId)         │                     │                  │
      ├─────────────────▶│                     │                  │
      │                  │                     │                  │
      │                  │ 1. checkAvail..()   │                  │
      │                  ├────────────────────▶│                  │
      │                  │◀────────────────────┤                  │
      │                  │                     │                  │
      │                  │ 2. keyExists()      │                  │
      │                  ├────────────────────▶│                  │
      │                  │◀────────────────────┤                  │
      │                  │                     │                  │
      │                  │ [if exists]         │                  │
      │                  │ 3. deleteKeys()     │                  │
      │                  ├────────────────────▶│                  │
      │                  │◀────────────────────┤                  │
      │                  │                     │                  │
      │                  │ 4. createKeys()     │                  │
      │                  ├────────────────────▶│                  │
      │                  │    🖐️ Biometric     │                  │
      │                  │    Prompt           │                  │
      │                  │◀────────────────────┤                  │
      │                  │ {publicKey,keyAlias}│                  │
      │                  │                     │                  │
      │                  │ 5. POST /biometric/register            │
      │                  │ {userId, publicKey, keyAlias}          │
      │                  ├───────────────────────────────────────▶│
      │                  │◀───────────────────────────────────────┤
      │                  │ {message, credential}                  │
      │                  │                     │                  │
      │◀─────────────────┤                     │                  │
      │ {success: true}  │                     │                  │
```

#### Key Differences from WebAuthn

| Aspect               | WebAuthn                          | Native Biometric                  |
|----------------------|-----------------------------------|-----------------------------------|
| Key generation       | `navigator.credentials.create()`  | `BiometricBridge.createKeys()`    |
| Key storage          | Browser platform authenticator    | Android Keystore / iOS Keychain   |
| Public key format    | COSE (CBOR)                       | Base64-encoded DER/PEM            |
| Frontend storage     | Credential ID in localStorage     | None (managed by native SDK)      |
| Biometric prompt     | Browser dialog                    | Native OS dialog                  |

---

## Biometric Login Flow

Passwordless authentication using a previously registered biometric credential.
There are two variants depending on the runtime environment.

### Prerequisites (both flows)

- User has registered at least one biometric credential
- Biometric hardware is available

---

### Variant A: WebAuthn (Desktop Browser)

```
┌──────────┐                              ┌──────────┐
│  Browser │                              │  Server  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │  1. User clicks "WebAuthn Login"        │
     │                                         │
     │  POST /api/biometric/challenge ────────►│
     │                                         │
     │             2. Generate random nonce    │
     │                Store in MongoDB with    │
     │                expiry (60s)             │
     │                                         │
     │  ◄──── { challenge: "base64..." }       │
     │                                         │
     │  3. Load credential IDs from            │
     │     localStorage                        │
     │                                         │
     │  4. Call WebAuthn get assertion         │
     │     navigator.credentials.get({         │
     │       publicKey: {                      │
     │         challenge,                      │
     │         allowCredentials: [ids],        │
     │         userVerification: "required"    │
     │       }                                 │
     │     })                                  │
     │                                         │
     │  ┌──────────────────────────────────┐   │
     │  │ OS prompts for fingerprint/face  │   │
     │  │ Authenticator signs:             │   │
     │  │   authData || SHA-256(clientJSON)│   │
     │  └──────────────────────────────────┘   │
     │                                         │
     │  5. POST /api/biometric/verify ────────►│
     │  {                                      │
     │    credentialId,                        │
     │    signature,                           │
     │    authenticatorData,                   │
     │    clientDataJSON,                      │
     │    payload: challenge                   │
     │  }                                      │
     │                                         │
     │              6. Server verification     │
     │                 a. Find challenge       │
     │                 b. Check not expired    │
     │                 c. Find credential      │
     │                    by credentialId      │
     │                 d. Validate clientData  │
     │                 e. Reconstruct signed   │
     │                    data (WebAuthn fmt)  │
     │                 f. Verify ECDSA sig     │
     │                 g. Mark challenge used  │
     │                 h. Issue JWT token      │
     │                                         │
     │  ◄── { accessToken, userId, email }     │
     │                                         │
     │  7. Store JWT in localStorage           │
     │     Redirect to /dashboard              │
     │                                         │
```

---

### Variant B: Native Biometric (Mobile WebView)

```
┌───────────┐     ┌──────────────┐      ┌──────────────┐     ┌─────────┐
│  Login    │     │ BiometricCtx │      │BioBridge→JS  │     │ Backend │
│  Page     │     │  Provider    │      │  → Native    │     │  API    │
└─────┬─────┘     └──────┬───────┘      └──────┬───────┘     └────┬────┘
      │                  │                     │                  │
      │ loginWithBio()   │                     │                  │
      ├─────────────────▶│                     │                  │
      │                  │                     │                  │
      │                  │ 1. POST /biometric/challenge           │
      │                  ├───────────────────────────────────────▶│
      │                  │◀───────────────────────────────────────┤
      │                  │ {challenge: "nonce"}│                  │
      │                  │                     │                  │
      │                  │ 2. sign(challenge)  │                  │
      │                  ├────────────────────▶│                  │
      │                  │    🖐️ Biometric     │                  │
      │                  │    Prompt           │                  │
      │                  │◀────────────────────┤                  │
      │                  │ {signature,publicKey│                  │
      │                  │  payload}           │                  │
      │                  │                     │                  │
      │                  │ 3. POST /biometric/verify              │
      │                  │ {signature, publicKey, payload}        │
      │                  ├───────────────────────────────────────▶│
      │                  │              4. Server verifies        │
      │                  │                 a. Find challenge      │
      │                  │                 b. Check not expired   │
      │                  │                 c. Find credential     │
      │                  │                    by publicKey        │
      │                  │                 d. Direct ECDSA verify │
      │                  │                    (SHA-256 payload)   │
      │                  │                 e. Mark challenge used │
      │                  │                 f. Issue JWT token     │
      │                  │◀───────────────────────────────────────┤
      │                  │ {accessToken, userId, email}           │
      │                  │                     │                  │
      │◀─────────────────┤                     │                  │
      │ {success,        │                     │                  │
      │  accessToken}    │                     │                  │
      │                  │                     │                  │
      │ 5. Store JWT     │                     │                  │
      │    Redirect to   │                     │                  │
      │    /dashboard    │                     │                  │
```

### Signature Verification (Backend)

The backend supports two verification methods:

**Native Biometric** — Direct ECDSA signature verification:

```
signedData = SHA-256(payload)    // or raw payload depending on native SDK
valid = ECDSA_verify(publicKey, signedData, signature)
```

**WebAuthn** — Assertion verification per WebAuthn spec:

```
signedData = authenticatorData + SHA-256(clientDataJSON)
valid = ECDSA_verify(publicKey, signedData, signature)
```

The backend detects which method to use based on the presence of
`publicKey` (native) vs `credentialId` + `authenticatorData` (WebAuthn).

---

## Sequence Diagrams

### Complete User Journey (WebAuthn)

```
Register → Login → Enroll Biometric → Biometric Login → Dashboard

    ┌─────┐          ┌───────┐         ┌──────┐
    │User │          │Browser│         │Server│
    └──┬──┘          └───┬───┘         └──┬───┘
       │                 │                │
       │ fills form      │                │
       ├────────────────►│                │
       │                 │ POST /register │
       │                 │───────────────►│
       │                 │◄───────────────│
       │                 │ auto-login     │
       │                 │───────────────►│
       │                 │◄───────────────│ JWT
       │                 │                │
       │  sees dashboard │                │
       │◄────────────────│                │
       │                 │                │
       │ clicks "Enable  │                │
       │ Biometric"      │                │
       ├────────────────►│                │
       │                 │ WebAuthn create│
       │  fingerprint    │                │
       │◄────────────────│                │
       ├────────────────►│                │
       │                 │ POST /register │
       │                 │───────────────►│
       │                 │◄───────────────│
       │                 │                │
       │  logs out       │                │
       ├────────────────►│                │
       │                 │                │
       │ clicks "Bio     │                │
       │ Login"          │                │
       ├────────────────►│                │
       │                 │ POST /challenge│
       │                 │───────────────►│
       │                 │◄───────────────│ nonce
       │                 │                │
       │  fingerprint    │ WebAuthn get   │
       │◄────────────────│                │
       ├────────────────►│                │
       │                 │ POST /verify   │
       │                 │───────────────►│
       │                 │◄───────────────│ JWT
       │                 │                │
       │  sees dashboard │                │
       │◄────────────────│                │
```

### Complete User Journey (Native Biometric)

```
Register → Login → Enroll Biometric → Biometric Login → Dashboard

    ┌─────┐     ┌───────────┐     ┌──────────┐      ┌──────┐
    │User │     │WebView/FE │     │Flutter   │      │Server│
    └──┬──┘     └─────┬─────┘     └────┬─────┘      └──┬───┘
       │              │                │               │
       │ logs in with │                │               │
       │ email/pass   │                │               │
       ├─────────────►│ POST /login ──────────────────►│
       │              │◄──────────────── JWT           │
       │              │                │               │
       │ "Enable Bio" │                │               │
       ├─────────────►│                │               │
       │              │ checkAvailable │               │
       │              │───────────────►│               │
       │              │◄───────────────│               │
       │              │ createKeys     │               │
       │              │───────────────►│               │
       │  🖐️ bio      │                │               │
       │◄─────────────│◄───────────────│               │
       │  🖐️ scan     │                │               │
       ├─────────────►│───────────────►│ {publicKey}   │
       │              │                │               │
       │              │ POST /biometric/register ─────►│
       │              │◄───────────────────────────────│
       │              │                │               │
       │  logs out    │                │               │
       ├─────────────►│                │               │
       │              │                │               │
       │ "Bio Login"  │                │               │
       ├─────────────►│                │               │
       │              │ POST /challenge ──────────────►│
       │              │◄─────────────── nonce          │
       │              │ sign(challenge)│               │
       │              │───────────────►│               │
       │  🖐️ bio     │                 │               │
       │◄─────────────│◄───────────────│ {signature}   │
       │  🖐️ scan    │                 │               │
       ├─────────────►│                │               │
       │              │ POST /verify ─────────────────►│
       │              │◄──────────────── JWT           │
       │              │                │               │
       │  dashboard   │                │               │
       │◄─────────────│                │               │
```

---

## Error Handling

### Standard Error Response Format

All errors follow the NestJS standard format:

```json
{
  "statusCode": 401,
  "message": "Invalid or expired challenge",
  "error": "Unauthorized"
}
```

### Common Error Codes

| Status | Scenario                                  |
|--------|-------------------------------------------|
| 400    | Missing required fields, validation error |
| 401    | Invalid credentials, expired challenge    |
| 404    | User or credential not found              |
| 409    | Duplicate registration                    |

### Frontend Error Handling

The `api-client.ts` wraps all fetch calls and throws descriptive errors:

```typescript
if (!response.ok) {
  const errorData = await response.json();
  throw new Error(errorData.message || 'Request failed');
}
```

Pages catch errors and display them in a styled error banner:

```tsx
{error && (
  <div className="bg-red-50 border border-red-200 text-red-700 ...">
    {error}
  </div>
)}
```

---

## Configuration

### Backend Environment Variables

| Variable                     | Default | Description                       |
|------------------------------|---------|-----------------------------------|
| `PORT`                       | 3000    | Server port                       |
| `MONGODB_URI`                | —       | MongoDB connection string         |
| `JWT_SECRET`                 | —       | Secret key for signing JWT tokens |
| `JWT_EXPIRATION`             | 24h     | JWT token expiration time         |
| `BIOMETRIC_CHALLENGE_EXPIRY` | 60      | Challenge expiration (seconds)    |

### Frontend Environment Variables

| Variable              | Default | Description                     |
|-----------------------|---------|---------------------------------|
| `NEXT_PUBLIC_API_URL` | —       | Backend API base URL (required) |

#### Local development (same machine)

```env
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

#### Remote access (ngrok / LAN IP / production HTTPS)

When the frontend is served over HTTPS from an origin other than the backend,
set the URL to a **relative path** and add a `rewrites` proxy in `next.config.ts`.
This avoids mixed-content errors and makes the backend reachable from any
device without exposing it publicly.

```env
# .env.local
NEXT_PUBLIC_API_URL=/api
```

```typescript
// next.config.ts
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3000/api/:path*",
      },
    ];
  },
};
```

The browser calls `https://<your-origin>/api/...`; Next.js server-side
rewrites it to `http://localhost:3000/api/...`. No additional tunnel for the
backend is required — only the frontend port needs to be exposed.

> **HMR WebSocket (development):** When accessing via ngrok or a LAN IP,
> also add the hostname to `allowedDevOrigins` in `next.config.ts`:
>
> ```typescript
> allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok-free.dev", "192.168.x.x"],
> ```
> Without this, Next.js 15+ rejects the WebSocket connection used for hot
> reloading, causing the browser to display a WebSocket error in the console.

---

## Security Considerations

1. **Challenge-Response Pattern** — The server issues a one-time challenge
   that must be signed by the device's private key. This prevents replay attacks.

2. **Challenge Expiry** — Challenges expire after 60 seconds by default,
   limiting the window for interception.

3. **Single-Use Challenges** — Each challenge is marked as used after
   successful verification, preventing reuse.

4. **User Verification** — Both WebAuthn (`userVerification: "required"`)
   and native biometric flows ensure the user is physically present and
   verified via biometric.

5. **ES256 / ECDSA-SHA256** — Uses strong elliptic curve cryptography
   (P-256 curve) for all signature operations.

6. **JWT Authentication** — All protected endpoints require a valid JWT token
   in the `Authorization: Bearer` header.

7. **No Private Key Transmission** — The private key never leaves the device's
   secure hardware (TPM / Secure Enclave / Android Keystore / iOS Keychain).
   Only the public key and signature are transmitted.

8. **Dual-Path Verification** — The backend verifies signatures using the
   appropriate method (direct ECDSA for native, WebAuthn assertion format
   for browser), ensuring both paths are equally secure.