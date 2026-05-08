# Biometrics Auth — Frontend (Next.js)

Web frontend for the biometric authentication system, built with **Next.js 16**, **React 19**, and **TypeScript**. Serves as both a standalone desktop WebAuthn client and the embedded UI for the Flutter mobile app via WebView.

## 📐 Architecture

The frontend operates in **two modes**:

1. **Desktop Browser** — Uses the **WebAuthn API** directly for hardware-backed authentication (Windows Hello, Touch ID, security keys)
2. **Mobile WebView** — Communicates with the Flutter app's native biometric services through a **JavaScript bridge** (`BiometricBridge`)

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js Frontend                     │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ AuthContext  │  │ Biometric    │  │ API Client    │  │
│  │ (login/      │  │ Context      │  │ (fetch wrapper│  │
│  │  register/   │  │ (state mgmt) │  │  + error      │  │
│  │  logout)     │  │              │  │  handling)    │  │
│  └──────────────┘  └──────┬───────┘  └───────┬───────┘  │
│                           │                  │          │
│              ┌────────────┼───────────┐      │          │
│              │            │           │      │          │
│        ┌─────▼─────┐ ┌───▼────┐ ┌───▼───┐    │          │
│        │ WebAuthn  │ │ Bridge │ │ UI    │    │          │
│        │ (desktop) │ │(mobile)│ │ comps │    │          │
│        └───────────┘ └────────┘ └───────┘    │          │
└──────────────────────────────────────────────┼──────────┘
                                               │ HTTP/REST
                                               ▼
                                    ┌─────────────────────┐
                                    │  NestJS Backend     │
                                    │  (MongoDB + JWT)    │
                                    └─────────────────────┘
```

## 🚀 Getting Started

### Prerequisites

- **Node.js** 20+
- Running **NestJS backend** server (see root README)

### 1. Install Dependencies

```bash
cd frontend
npm install
```

### 2. Development Server

```bash
npm run dev
```

Opens on [http://localhost:3001](http://localhost:3001).

### 3. Production Build

> **Note**: WebAuthn requires HTTPS in production. Use a valid TLS certificate or a reverse proxy.

```bash
npm run build
npm start
```

### 4. Expose to Mobile App (Optional)

To connect the Flutter mobile app, expose the frontend via a tunnel:

```bash
# Using ngrok
ngrok http 3001

# Using Cloudflare Tunnel
cloudflared tunnel --url http://localhost:3001
```

Update `WEB_APP_URL` in the mobile app's `.env` file with the tunnel URL.

## 📁 Project Structure

```
src/
├── app/                              # Next.js App Router pages
│   ├── layout.tsx                    # Root layout with providers
│   ├── page.tsx                      # Home / redirect page
│   ├── login/page.tsx                # Login page (password + biometric)
│   ├── register/page.tsx             # Registration page
│   └── dashboard/page.tsx            # Protected dashboard (auth required)
│
├── contexts/                         # React Context providers
│   ├── auth-context.tsx              # Auth state: login, register, logout, JWT
│   └── biometric-context.tsx         # Biometric state: register, verify, sync
│
├── lib/                              # Core libraries and utilities
│   ├── api-client.ts                 # Typed HTTP client with auth headers
│   ├── biometric-bridge.ts           # JS bridge for Flutter WebView communication
│   ├── biometric-ui.tsx              # Biometric UI components (enable/disable/login)
│   ├── webauthn.ts                   # WebAuthn API wrapper (desktop browser)
│   ├── storage-keys.ts               # Secure storage key constants
│   └── types.ts                      # Shared TypeScript type definitions
│
└── types/                            # External type declarations
    └── flutter-inappwebview.d.ts     # InAppWebView JS bridge type definitions
```

## 🛠️ Tech Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Next.js** | 16 | React framework with App Router |
| **React** | 19 | UI library |
| **TypeScript** | 5 | Type safety |
| **Tailwind CSS** | 4 | Utility-first styling |

## 🔑 Key Modules

### API Client (`lib/api-client.ts`)

Typed HTTP client for backend communication:

- `authApi.register()` / `authApi.login()` / `authApi.getProfile()`
- `biometricApi.checkNativeCredential()` / `biometricApi.registerCredential()`
- `biometricApi.generateChallenge()` / `biometricApi.verifySignature()`
- `biometricApi.unregisterCredential()`

Handles Bearer token auth, JSON serialization, and the backend's `{ success, data, timestamp }` response envelope.

### Biometric Bridge (`lib/biometric-bridge.ts`)

JavaScript bridge for Flutter WebView communication:

- `isNativeApp()` — Detects mobile WebView environment
- `biometricBridge.createKeys()` / `biometricBridge.signChallenge()`
- `biometricBridge.biometricAvailable()` / `biometricBridge.deleteKey()`

Automatically falls back gracefully when not running inside a mobile app.

### WebAuthn (`lib/webauthn.ts`)

WebAuthn API wrapper for desktop browsers:

- Registration and authentication via platform authenticators
- Supports Windows Hello, macOS Touch ID, and hardware security keys

### Contexts

| Context | Purpose |
|---------|---------|
| `AuthContext` | Manages user authentication state (login, register, logout), JWT token storage, and profile data |
| `BiometricContext` | Manages biometric credential state (register, verify, check), multi-user sync, and platform detection |

## 🔐 Security

- **WebAuthn** requires HTTPS (except `localhost`) — see [WebAuthn Secure Context](../docs/WEBAUTHN_SECURE_CONTEXT.md)
- **JWT tokens** stored in localStorage (consider httpOnly cookies for production)
- **Biometric keys** never leave the device — only signatures are transmitted
- **Challenge-response** pattern prevents replay attacks

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [Frontend ↔ Backend Communication](../docs/FRONTEND_BACKEND_COMMUNICATION.md) | API reference and authentication flows |
| [Mobile ↔ Frontend Integration](../docs/MOBILE_FRONTEND_INTEGRATION.md) | JavaScript bridge architecture and handler registry |
| [WebAuthn Secure Context](../docs/WEBAUTHN_SECURE_CONTEXT.md) | HTTPS requirements and development setup |

## 📜 Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server on port 3001 |
| `npm run build` | Create production build |
| `npm run start` | Start production server |
| `npm run lint` | Run ESLint checks |