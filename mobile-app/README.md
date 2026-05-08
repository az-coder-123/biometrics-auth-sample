# Biometrics Auth — Mobile App (Flutter)

Cross-platform mobile application for biometric authentication using hardware-backed cryptography (Android Keystore / iOS Secure Enclave).

## 📐 Architecture

The app runs a **Next.js frontend inside a WebView** (`flutter_inappwebview`) and communicates with native biometric services through a **JavaScript bridge**. This hybrid approach provides:

- A shared web UI between desktop and mobile
- Native access to hardware-backed biometric signing
- Seamless integration with the NestJS backend

```
┌────────────────────────────────────────────────────┐
│                   Flutter App                      │
│                                                    │
│  ┌─────────────────┐      ┌─────────────────────┐  │
│  │ BiometricService│◄─────│  InAppWebView       │  │
│  │ (Dart)          │ JS   │  (Next.js Frontend) │  │
│  │                 │Bridge│                     │  │
│  │ - RSA-2048      │      │  - BiometricBridge  │  │
│  │ - Keystore/SE   │      │  - BiometricContext │  │
│  └─────────────────┘      └─────────────────────┘  │
└────────────────────────────────────────────────────┘
```

## 🚀 Getting Started

### Prerequisites

- **Flutter** 3.x+ (SDK ^3.11.5)
- **Android Studio** (for Android emulator / build tools)
- **Xcode** 15+ (for iOS simulator / build tools, macOS only)
- Running **backend** and **frontend** servers (see root README)

### 1. Install Dependencies

```bash
cd mobile-app
flutter pub get
```

### 2. Configure Environment

Copy the example environment file and update the URL for your setup:

```bash
cp .env.example .env
```

Edit `.env` and set the frontend URL:

```env
# Frontend web app URL (loaded in WebView)
WEB_APP_URL=http://localhost:3001
```

> **Tip**: For physical devices, use a tunneling service like **ngrok** to expose the frontend:
> ```bash
> ngrok http 3001
> ```
> Then set `WEB_APP_URL=https://your-ngrok-url.ngrok-free.app`

### 3. Run the App

```bash
flutter run
```

Choose a target device (Android emulator, iOS simulator, or physical device).

## 📁 Project Structure

```
lib/
├── main.dart                          # App entry point, loads .env and launches WebView
├── core/
│   ├── config/
│   │   └── app_config.dart            # Centralized configuration constants
│   └── utils/
│       └── secure_storage_util.dart   # Flutter Secure Storage helper
└── features/
    ├── biometric/
    │   └── services/
    │       └── biometric_service.dart # Hardware-backed biometric signing
    └── webview/
        └── pages/
            └── webview_page.dart      # WebView with JS bridge integration
```

## 🛠️ Tech Stack

| Package | Purpose |
|---------|---------|
| `flutter_inappwebview` | WebView with JavaScript bridge support |
| `biometric_signature` | Hardware-backed RSA key generation & signing |
| `local_auth` | Biometric availability check & prompts |
| `flutter_secure_storage` | Encrypted storage for tokens and keys |
| `flutter_dotenv` | Load environment variables from `.env` file |
| `http` | HTTP client for API calls |
| `logger` | Structured logging |

## 📱 Platform Support

| Platform | Minimum Version | Biometric Support |
|----------|----------------|-------------------|
| **Android** | 6.0+ (API 23) | Fingerprint / Face unlock |
| **iOS** | 11.0+ | Touch ID / Face ID |

## 🔐 Security

- **Private keys** are generated and stored in hardware-backed keystores (Android Keystore / iOS Secure Enclave) — they never leave the device
- **Biometric authentication** is required for every signing operation
- **Challenge-response** pattern prevents replay attacks
- **JWT tokens** are stored in Flutter Secure Storage (encrypted on disk)

## 🔧 Troubleshooting

### "Biometric not available"

Ensure at least one biometric (fingerprint/face) is enrolled in device **Settings → Security**.

### WebView shows blank page

Check that `WEB_APP_URL` in `.env` points to a running frontend server accessible from the device.

### Build errors on iOS

```bash
cd ios && pod install && cd ..
flutter clean && flutter pub get
flutter run