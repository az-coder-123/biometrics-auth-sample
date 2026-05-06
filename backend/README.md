# Biometrics Auth Backend

A secure biometric authentication backend service built with **NestJS** and **MongoDB**, implementing challenge-response authentication using ECDSA public key cryptography.

## Architecture

The project follows **Clean Architecture** and **Single Responsibility Principle**:

```
backend/
├── src/
│   ├── main.ts                              # Application bootstrap
│   ├── app.module.ts                        # Root module
│   ├── config/
│   │   └── configuration.ts                 # Environment configuration
│   ├── common/
│   │   ├── decorators/
│   │   │   └── current-user.decorator.ts    # @CurrentUser() parameter decorator
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts     # Global exception handler
│   │   ├── guards/
│   │   │   └── jwt-auth.guard.ts            # JWT authentication guard
│   │   └── interceptors/
│   │       └── transform.interceptor.ts     # Response transformation
│   ├── auth/
│   │   ├── auth.module.ts                   # Auth feature module
│   │   ├── auth.controller.ts               # Auth REST endpoints
│   │   ├── auth.service.ts                  # Auth business logic
│   │   ├── dto/
│   │   │   ├── register.dto.ts              # Registration DTO
│   │   │   └── login.dto.ts                 # Login DTO
│   │   ├── interfaces/
│   │   │   └── jwt-payload.interface.ts     # JWT payload type
│   │   ├── schemas/
│   │   │   └── user.schema.ts               # User MongoDB schema
│   │   └── strategies/
│   │       └── jwt.strategy.ts              # Passport JWT strategy
│   └── biometric/
│       ├── biometric.module.ts              # Biometric feature module
│       ├── biometric.controller.ts          # Biometric REST endpoints
│       ├── biometric.service.ts             # Biometric business logic
│       ├── dto/
│       │   ├── biometric-register.dto.ts    # Registration DTO
│       │   └── biometric-verify.dto.ts      # Verification DTO
│       └── schemas/
│           ├── biometric-credential.schema.ts # Credential MongoDB schema
│           └── challenge.schema.ts           # Challenge MongoDB schema
```

## Authentication Flows

### Registration Flow

1. **User Registration** — `POST /api/auth/register`
   - User registers with email, password, and full name
   - Password is hashed with bcrypt before storage
   - Returns user data (excluding password)

2. **Biometric Credential Registration** — `POST /api/biometric/register`
   - Device generates an ECDSA key pair in secure hardware
   - The public key is sent to the server and stored
   - Associates the credential with the user account

### Authentication Flow

1. **Challenge Generation** — `POST /api/biometric/challenge`
   - Client requests a one-time challenge nonce
   - Server stores the challenge with a 5-minute TTL
   - Returns `{ challengeId, challenge }` to the client

2. **Signature Verification** — `POST /api/biometric/verify`
   - Client signs the challenge using the device's private key
   - Sends `{ signature, publicKey, payload }` to the server
   - Server verifies the ECDSA signature against the stored public key
   - On success, returns a JWT access token

## API Endpoints

### Auth Endpoints

| Method | Endpoint              | Description              | Auth |
|--------|-----------------------|--------------------------|------|
| POST   | `/api/auth/register`  | Register a new user      | No   |
| POST   | `/api/auth/login`     | Login with credentials   | No   |
| GET    | `/api/auth/profile`   | Get user profile         | JWT  |

### Biometric Endpoints

| Method | Endpoint                  | Description                        | Auth |
|--------|---------------------------|------------------------------------|------|
| POST   | `/api/biometric/register` | Register biometric credential      | No   |
| POST   | `/api/biometric/challenge`| Generate challenge nonce           | No   |
| POST   | `/api/biometric/verify`   | Verify signature & get token       | No   |
| POST   | `/api/biometric/unregister`| Remove biometric credential       | JWT  |

## Setup

### Prerequisites

- Node.js >= 20.x
- MongoDB >= 6.0 (running locally or via Docker)

### Installation

```bash
cd backend
npm install
```

### Configuration

Copy the example environment file and update values:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017/biometrics-auth

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRATION=1h

# Application
PORT=3000
```

### Running

```bash
# Development mode with hot reload
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

### Build

```bash
npm run build
```

## Security Considerations

- **Passwords** are hashed with bcrypt (10 salt rounds)
- **JWT tokens** are signed with a configurable secret
- **Challenge nonces** expire after 5 minutes (one-time use)
- **ECDSA signatures** are verified using Node.js `crypto` module
- **Input validation** is enforced via `class-validator` decorators

## License

MIT