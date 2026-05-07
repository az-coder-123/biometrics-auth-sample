# Biometrics Authentication Sample

A complete **biometric authentication system** demonstrating hardware-backed cryptography for mobile and desktop platforms.

## 🎯 Features

- ✅ **Native Mobile Biometric** (Android fingerprint/face + iOS Face ID/Touch ID)
- ✅ **WebAuthn Desktop** (Windows Hello, Touch ID, hardware security keys)
- ✅ **Hardware-Backed Keys** (Android Keystore/StrongBox, iOS Secure Enclave)
- ✅ **Challenge-Response Flow** (replay attack prevention)
- ✅ **Dual-Mode Backend** (supports both native and WebAuthn verification)
- ✅ **Multiple Credentials** (users can register on multiple devices simultaneously)
- ✅ **Multi-User State Sync** (correct UI state when multiple users share one device)
- ✅ **JWT Authentication** (stateless session management)
- ✅ **Production-Ready** (error handling, logging, TypeScript strict mode)

---

## 📐 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│               Mobile App (Flutter + InAppWebView)               │
│                                                                 │
│  ┌──────────────────────┐      ┌──────────────────────────┐     │
│  │  BiometricService    │◄────▶│  Next.js Frontend        │     │
│  │  (Dart)              │  JS  │  (React + TypeScript)    │     │
│  │                      │Bridge│                          │     │
│  │  - Android Keystore  │      │  - BiometricBridge       │     │
│  │  - iOS Secure Enclave│      │  - BiometricContext      │     │
│  └──────────────────────┘      └──────────────────────────┘     │
│                                          │                       │
└──────────────────────────────────────────┼───────────────────────┘
                                           │ HTTP/REST
                                           ▼
                    ┌──────────────────────────────────────┐
                    │   Backend (NestJS + MongoDB)         │
                    │                                      │
                    │  - BiometricService                  │
                    │  - Challenge generation              │
                    │  - RSA-SHA256 verification (native)  │
                    │  - ECDSA verification (WebAuthn)     │
                    │  - JWT token issuance                │
                    └──────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 20+ (backend + frontend)
- **Flutter** 3.x+ (mobile app)
- **MongoDB** 5+ (database)
- **Android Studio** / **Xcode** (for mobile development)

### 1. Backend Setup

```bash
cd backend
npm install
cp .env.example .env  # Configure MongoDB URI, JWT secret, etc.
npm run start:dev     # Starts on http://localhost:3000
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev           # Starts on http://localhost:3001
```

For production (HTTPS required for WebAuthn):
```bash
npm run build
npm start             # Or deploy to Vercel/Netlify
```

**Note**: Use **ngrok** or **Cloudflare Tunnel** to expose frontend to mobile app:
```bash
ngrok http 3001
# Update mobile-app/lib/core/constants/app_constants.dart with ngrok URL
```

### 3. Mobile App Setup

```bash
cd mobile-app
flutter pub get
flutter run           # Choose device (Android emulator/iOS simulator)
```

Update the frontend URL in `lib/core/constants/app_constants.dart`:
```dart
static const String frontendUrl = 'https://your-ngrok-url.ngrok-free.app';
```

---

## 📖 Documentation

Detailed guides for developers:

| Document | Description |
|----------|-------------|
| [**Biometric Authentication Flow**](./docs/BIOMETRIC_AUTHENTICATION_FLOW.md) | Complete flow diagrams for registration and login (native biometric) |
| [**Mobile ↔ Frontend Integration**](./docs/MOBILE_FRONTEND_INTEGRATION.md) | JavaScript bridge architecture and handler registry |
| [**Frontend ↔ Backend Communication**](./docs/FRONTEND_BACKEND_COMMUNICATION.md) | API reference and authentication flows |
| [**WebAuthn Secure Context**](./docs/WEBAUTHN_SECURE_CONTEXT.md) | HTTPS requirements and development setup |
| [**Bug: Null Key Alias**](./docs/BUG_NULL_KEY_ALIAS_SIGNING_FAILURE.md) | Resolved issue with biometric_signature package |

---

## 🔑 How It Works

### Registration Flow

1. User clicks **"Enable Biometric Login"** on mobile app
2. Mobile app shows **biometric prompt** ("Authenticate to enable biometric login")
3. After successful authentication, mobile app generates **RSA-2048 key pair**:
   - **Private key**: Stored in hardware (Android Keystore/iOS Keychain), never leaves device
   - **Public key**: Sent to backend for storage
4. Backend stores public key in MongoDB linked to user account

### Login Flow

1. User clicks **"Login with Biometric"**
2. Frontend requests **challenge** from backend (random 32-byte nonce)
3. Mobile app shows **biometric prompt** ("Authenticate to login")
4. After successful authentication, mobile app **signs challenge** with private key
5. Frontend sends **signature + challenge** to backend
6. Backend **verifies signature** using stored public key
7. If valid, backend issues **JWT token** and user is logged in

**Security Features**:
- ✅ Challenge is **single-use** (cannot replay)
- ✅ Challenge **expires after 5 minutes**
- ✅ Private key **cannot be extracted** from device
- ✅ Biometric required for **every signature** operation

---

## 🛠️ Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Mobile App** | Flutter 3.x | Cross-platform mobile framework |
| | `flutter_inappwebview` | WebView with JS bridge |
| | `biometric_signature` | Hardware-backed RSA signing |
| | `local_auth` | Biometric prompts |
| **Frontend** | Next.js 15 (React 19) | Web application framework |
| | TypeScript | Type safety |
| | Tailwind CSS | Styling |
| **Backend** | NestJS 11 | Node.js framework |
| | TypeScript | Type safety |
| | Passport JWT | Authentication middleware |
| | Mongoose | MongoDB ODM |
| **Database** | MongoDB 5+ | NoSQL database |
| **Security** | RSA-2048 + SHA-256 | Native biometric signing |
| | ECDSA P-256 + SHA-256 | WebAuthn signing |
| | JWT | Stateless sessions |

---

## 📱 Platform Support

### Mobile
- ✅ **Android 6.0+** (API level 23+) with fingerprint/face unlock
- ✅ **iOS 11.0+** with Touch ID or Face ID

### Desktop (WebAuthn)
- ✅ **Windows 10+** with Windows Hello
- ✅ **macOS** with Touch ID
- ✅ **Chrome/Edge/Safari/Firefox** (latest versions)
- ✅ Hardware security keys (YubiKey, etc.)

---

## 🔐 Security Considerations

### ✅ What's Protected

- Private keys stored in **hardware-backed keystores** (TEE/Secure Enclave)
- Biometric authentication required for **every signature**
- Challenges are **single-use** and **time-limited**
- Public keys stored server-side are **read-only**
- JWT tokens use **HMAC-SHA256** signing

### ⚠️ Limitations

- Rooted/jailbroken devices may have compromised keystores
- Biometric data never leaves the device (OS-level protection)
- Man-in-the-middle attacks possible without HTTPS (use TLS in production)
- JWT tokens should be stored securely (httpOnly cookies recommended)

---

## 🐛 Troubleshooting

### "Biometric not available" on real device

**Cause**: User hasn't enrolled biometrics in device settings.

**Solution**: Go to **Settings → Security → Fingerprint/Face unlock** and enroll at least one biometric.

### "Login failed. Please try again"

**Cause**: Signature verification failed on backend.

**Solutions**:
1. Check backend logs for specific error (public key format, algorithm mismatch, etc.)
2. Ensure backend is running and accessible from frontend
3. Verify public key in MongoDB matches the one used during registration
4. Confirm RSA-SHA256 algorithm is used consistently

### WebAuthn not working on localhost

**Cause**: WebAuthn requires HTTPS (except for `localhost`).

**Solution**: Use `https://localhost:3001` with self-signed certificate, or deploy to production with valid TLS.

See [WebAuthn Secure Context](./docs/WEBAUTHN_SECURE_CONTEXT.md) for detailed setup.

### "Disable Biometric Login" shown for user who never registered

**Cause**: Multiple users sharing the same device. Device has biometric keys from a previous user in local storage.

**Solution**: This is now **automatically fixed** after password login. The frontend verifies credential ownership with the backend (`POST /api/biometric/check`) to ensure the UI shows the correct state for the current user.

**Technical Details**:
- Device storage is **not user-scoped**, so keys persist across user sessions
- After login, `verifyRegistrationWithBackend()` checks if the current user owns the device's key
- UI state: `isRegistered = deviceHasKey && backendHasCredential`

---

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.

---

## 👥 Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📞 Support

For questions or issues:

- 📖 Read the [documentation](./docs/)
- 🐛 Open an [issue](https://github.com/yourusername/biometrics-auth-sample/issues)
- 💬 Start a [discussion](https://github.com/yourusername/biometrics-auth-sample/discussions)

---

**Built with ❤️ using Flutter, React, and NestJS**
