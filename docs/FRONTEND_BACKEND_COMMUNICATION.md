# Frontend–Backend Communication Guide

This document describes how the **Next.js frontend** and **NestJS backend**
communicate during the authentication and biometric enrollment flows.

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
┌──────────────────────┐       HTTP/REST         ┌──────────────────────┐
│                      │ ──────────────────────► │                      │
│   Next.js Frontend   │    JSON over HTTP       │   NestJS Backend     │
│   (Port 3001)        │ ◄────────────────────── │   (Port 3000)        │
│                      │                         │                      │
│  ┌────────────────┐  │                         │  ┌────────────────┐  │
│  │ WebAuthn API   │  │                         │  │ Auth Module    │  │
│  │ (Browser)      │  │                         │  │ Biometric Mod. │  │
│  └────────────────┘  │                         │  │ JWT Guard      │  │
│  ┌────────────────┐  │                         │  └────────────────┘  │
│  │ Auth Context   │  │                         │  ┌────────────────┐  │
│  │ (React State)  │  │                         │  │ MongoDB        │  │
│  └────────────────┘  │                         │  │ (Collections)  │  │
│  ┌────────────────┐  │                         │  └────────────────┘  │
│  │ API Client     │  │                         │                      │
│  │ (fetch wrapper)│  │                         │                      │
│  └────────────────┘  │                         │                      │
└──────────────────────┘                         └──────────────────────┘
```

### Technology Stack

| Layer      | Frontend                        | Backend                    |
|------------|---------------------------------|----------------------------|
| Framework  | Next.js 16 (React 19)           | NestJS 11                  |
| Auth       | WebAuthn API + JWT (localStorage)| Passport JWT + bcrypt     |
| Styling    | Tailwind CSS                    | N/A                        |
| Database   | N/A                             | MongoDB (Mongoose)         |
| Port       | 3001                            | 3000                       |

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

| Field       | Type   | Required | Description                           |
|-------------|--------|----------|---------------------------------------|
| `userId`    | string | ✓        | MongoDB user `_id`                    |
| `publicKey` | string | ✓        | Base64url-encoded COSE public key     |
| `keyAlias`  | string |          | Credential ID (base64url)             |

**Response (201):**

```json
{
  "message": "Biometric credential registered successfully",
  "credential": {
    "id": "682a...",
    "publicKey": "pAEBA...base64url",
    "keyAlias": "a1B2c3...base64url",
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
  "challenge": "dGhpcyBpcyBhIHJhbmRvb...base64url"
}
```

> The challenge is a 32-byte cryptographically random value encoded as
> base64url. It expires after 5 minutes (configurable).

---

#### `POST /api/biometric/verify`

Verifies a WebAuthn assertion signature and returns a JWT token.

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
passwordless authentication.

### Prerequisites

- User must be logged in (JWT token available)
- Browser must support WebAuthn
- Platform authenticator (biometric hardware) must be available

### Steps

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

### Frontend Storage

After successful registration, the credential ID is stored in localStorage
keyed by user email:

```typescript
const STORAGE_KEY = `biometrics_cred_ids_${email}`;
localStorage.setItem(STORAGE_KEY, JSON.stringify([credentialId]));
```

---

## Biometric Login Flow

Passwordless authentication using a previously registered biometric credential.

### Prerequisites

- User has registered at least one biometric credential
- Credential ID is stored in localStorage
- Browser supports WebAuthn

### Steps

```
┌──────────┐                              ┌──────────┐
│  Browser │                              │  Server  │
└────┬─────┘                              └────┬─────┘
     │                                         │
     │  1. User clicks "Biometric Login"       │
     │                                         │
     │  POST /api/biometric/challenge ────────►│
     │                                         │
     │             2. Generate random nonce    │
     │                Store in MongoDB with    │
     │                expiry (5 min)           │
     │                                         │
     │  ◄──── { challenge: "base64url..." }    │
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
     │  │ Returns: signature, authData,    │   │
     │  │          clientDataJSON, rawId   │   │
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
     │                    (type + challenge)   │
     │                 e. Reconstruct signed   │
     │                    data per WebAuthn:   │
     │                    authData ||          │
     │                      SHA-256(clientJSON)│
     │                 f. Verify ECDSA sig     │
     │                    using stored pubkey  │
     │                 g. Mark challenge used  │
     │                 h. Issue JWT token      │
     │                                         │
     │  ◄── { accessToken, userId, email }     │
     │                                         │
     │  7. Store JWT in localStorage           │
     │     Redirect to /dashboard              │
     │                                         │
```

### WebAuthn Signature Verification (Backend)

The backend verifies the assertion signature using this formula:

```
signedData = authenticatorData + SHA-256(clientDataJSON)
valid = ECDSA_verify(publicKey, signedData, signature)
```

The stored public key is in COSE format (from `getPublicKey()`). The backend
converts it to PEM via:

1. Parse CBOR-encoded COSE key to extract x, y coordinates (P-256 curve)
2. Construct uncompressed EC point: `0x04 || x || y`
3. Wrap in SubjectPublicKeyInfo ASN.1 DER structure
4. Base64-encode and wrap in PEM headers

---

## Sequence Diagrams

### Complete User Journey

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
| `BIOMETRIC_CHALLENGE_EXPIRY` | 300     | Challenge expiration (seconds)    |

### Frontend Environment Variables

| Variable              | Default | Description                     |
|-----------------------|---------|---------------------------------|
| `NEXT_PUBLIC_API_URL` | —       | Backend API base URL (required) |

Example `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000/api
```

---

## Security Considerations

1. **Challenge-Response Pattern** — The server issues a one-time challenge
   that must be signed by the device's private key. This prevents replay attacks.

2. **Challenge Expiry** — Challenges expire after 5 minutes by default,
   limiting the window for interception.

3. **Single-Use Challenges** — Each challenge is marked as used after
   successful verification, preventing reuse.

4. **WebAuthn User Verification** — The `userVerification: "required"` setting
   ensures the user is physically present and verified via biometric.

5. **ES256 (P-256 + SHA-256)** — Uses strong elliptic curve cryptography
   for all signature operations.

6. **JWT Authentication** — All protected endpoints require a valid JWT token
   in the `Authorization: Bearer` header.

7. **No Private Key Transmission** — The private key never leaves the device's
   secure hardware (TPM/Secure Enclave). Only the public key and signature
   are transmitted.