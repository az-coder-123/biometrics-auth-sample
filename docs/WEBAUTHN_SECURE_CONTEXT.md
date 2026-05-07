# WebAuthn Secure Context Requirement

This document explains why WebAuthn biometric detection only works on certain
origins, how the frontend handles this, and how to set up HTTPS for development
and production.

---

## Table of Contents

1. [What Is a Secure Context?](#what-is-a-secure-context)
2. [Why This Affects WebAuthn Detection](#why-this-affects-webauthn-detection)
3. [Origin Comparison Table](#origin-comparison-table)
4. [How the Frontend Handles This](#how-the-frontend-handles-this)
5. [Detection Helper Functions](#detection-helper-functions)
6. [UI Behaviour per Context](#ui-behaviour-per-context)
7. [Setting Up HTTPS for Development](#setting-up-https-for-development)
8. [Setting Up HTTPS for Production](#setting-up-https-for-production)

---

## What Is a Secure Context?

A **Secure Context** is an origin that meets the security requirements defined
by the W3C. Browsers only expose privileged APIs (WebAuthn, Web Crypto,
Service Workers, etc.) to pages that run in a Secure Context.

An origin is a Secure Context when **at least one** of the following is true:

- The scheme is `https://`
- The host is `localhost` (any port)
- The host is `127.0.0.1` (IPv4 loopback)
- The host is `::1` (IPv6 loopback)

> **Reference:** [W3C Secure Contexts spec](https://www.w3.org/TR/secure-contexts/)
> and [`window.isSecureContext` on MDN](https://developer.mozilla.org/en-US/docs/Web/API/isSecureContext)

---

## Why This Affects WebAuthn Detection

When a page is **not** in a Secure Context, browsers deliberately hide or
disable the WebAuthn API surface:

- **Chrome / Edge** — `window.PublicKeyCredential` is `undefined`
- **Firefox** — similar restriction
- **Safari** — similar restriction

As a result, any check like `!!window.PublicKeyCredential` returns `false` on
a plain HTTP non-localhost origin, even if the device has a fingerprint sensor
and biometrics enrolled. The API is hidden by design — **this is not a bug in
the app**.

### Symptom

| URL accessed | `window.isSecureContext` | `window.PublicKeyCredential` | Detection result |
|---|---|---|---|
| `http://localhost:3001` | `true` | Defined | ✅ Detected correctly |
| `http://127.0.0.1:3001` | `true` | Defined | ✅ Detected correctly |
| `http://192.168.1.11:3001` | `false` | `undefined` | ❌ Always "not supported" |
| `https://example.com` | `true` | Defined | ✅ Detected correctly |

This is why the app shows **"Biometric authentication is not available"** when
accessed via a local IP address over HTTP, even on a machine with Touch ID or
Windows Hello configured.

---

## How the Frontend Handles This

### Before (incorrect)

The original code called `isPlatformAuthenticatorAvailable()` inside a
`useEffect` hook:

```ts
// dashboard/page.tsx (old)
useEffect(() => {
  if (!isNative) {
    isPlatformAuthenticatorAvailable().then(setWebAuthnAvailable);
  }
}, [isNative]);
```

`isPlatformAuthenticatorAvailable()` resolves to `false` on non-secure origins
because `window.PublicKeyCredential` is `undefined`, but the warning message
shown to the user only said *"device not supported"* — giving no hint about the
actual cause.

Additionally, calling `setState` synchronously inside an `useEffect` body
causes cascading renders and is discouraged by React's own linting rules.

### After (correct)

`webAuthnAvailable` is now derived via `useSyncExternalStore`, which avoids
hydration mismatches (SSR vs client) and requires no extra render cycle:

```ts
// dashboard/page.tsx & login/page.tsx (current)
const httpsContext = useSyncExternalStore(
  () => () => {},        // no subscription needed
  () => isSecureContext(),
  () => false,           // server snapshot — always false on SSR
);

const webAuthnAvailable = useSyncExternalStore(
  () => () => {},
  () => isWebAuthnSupported(),
  () => false,
);
```

And the warning now shows a specific message for non-secure origins:

```tsx
{!isNative && !httpsContext
  ? "WebAuthn requires a secure connection. Please access this app via HTTPS ..."
  : "Biometric authentication is not available on this device ..."}
```

---

## Detection Helper Functions

Both helpers live in `frontend/src/lib/webauthn.ts`.

### `isSecureContext(): boolean`

Returns `true` when running inside a Secure Context.

```ts
export function isSecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext;
}
```

Use this to give users actionable feedback when WebAuthn is unavailable due to
the connection type, not due to missing biometric hardware.

### `isWebAuthnSupported(): boolean`

Returns `true` when the browser exposes the WebAuthn API **and** the page is
in a Secure Context. Both conditions must be true for WebAuthn to work.

```ts
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    !!window.PublicKeyCredential
  );
}
```

---

## UI Behaviour per Context

### Dashboard — Biometric Settings card

| Scenario | `httpsContext` | `webAuthnAvailable` | UI shown |
|---|---|---|---|
| HTTP non-localhost | `false` | `false` | "WebAuthn requires a secure connection…" |
| HTTPS / localhost, browser no WebAuthn | `true` | `false` | "Biometric authentication is not available on this device…" |
| HTTPS / localhost, WebAuthn available | `true` | `true` | Enable / Disable biometric buttons |
| Inside Flutter WebView, bridge loading | — | — | Loading skeleton (`loading=true`) |
| Inside Flutter WebView, biometrics available | — | — | Native biometric controls with dynamic icon |

### Login page — Native WebView (4 states via JS bridge)

| State | Condition | UI shown |
|---|---|---|
| Checking | `isNative && loading` | Spinner: *"Checking biometric availability…"* |
| Enrolled | `isNative && !loading && canAuthenticate && isRegistered` | Button: `BiometricIcon` + *"Face ID Login"* / *"Fingerprint Login"* |
| Not enrolled | `isNative && !loading && canAuthenticate && !isRegistered` | Amber hint: *"Enable from Dashboard → Biometric Settings"* |
| Not available | `isNative && !loading && !canAuthenticate` | Nothing |

### Login page — Browser WebAuthn

| Scenario | `webAuthnAvailable` | Button shown? |
|---|---|---|
| HTTP non-localhost | `false` | No |
| HTTPS / localhost, WebAuthn available | `true` | Yes — "WebAuthn Login" (fingerprint icon) |
| Inside Flutter WebView | N/A | Native path takes precedence |

---

## Setting Up HTTPS for Development

When you need to test WebAuthn from **another device on the same network**
(e.g., a mobile phone connecting via Wi-Fi to `192.168.x.x`), you need HTTPS.
`localhost` only works from the same machine.

### Recommended: ngrok + Next.js API proxy

This is the cleanest approach. It requires only **one** ngrok tunnel (for the
frontend) and avoids mixed-content errors by having the Next.js server proxy
API calls to the backend.

```bash
# 1. Tunnel only the frontend (port 3001)
ngrok http 3001
# → https://xxxx.ngrok-free.app
```

```env
# 2. .env.local — use a relative URL so the browser never calls HTTP directly
NEXT_PUBLIC_API_URL=/api
```

```typescript
// 3. next.config.ts — proxy /api/* → localhost:3000/api/* server-side
const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.io"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: "http://localhost:3000/api/:path*" }];
  },
};
```

```bash
# 4. Restart the Next.js dev server to pick up the env var change
npm run dev
```

Open `https://xxxx.ngrok-free.app` on any device. The browser calls
`https://xxxx.ngrok-free.app/api/...`; Next.js forwards it to
`http://localhost:3000/api/...` server-side. No second tunnel needed.

> **Why `allowedDevOrigins` matters:** Next.js 15+ rejects WebSocket HMR
> connections from unlisted origins. Without this, the browser console shows
> *"WebSocket connection to 'wss://…/_next/webpack-hmr?id=…' failed"* and
> hot-reload does not work.

---

### Option 1 — ngrok (frontend only, use with API proxy)

```bash
# Install: https://ngrok.com/download
ngrok http 3001
# → Forwarding  https://xxxx.ngrok-free.app → http://localhost:3001
```

Use together with `NEXT_PUBLIC_API_URL=/api` and `rewrites` (see Recommended
above) so the browser never calls the backend HTTP URL directly.

### Option 2 — Cloudflare Tunnel (free, no account required for one-shot)

```bash
# macOS
brew install cloudflared
cloudflared tunnel --url http://localhost:3001
# → https://xxxx.trycloudflare.com
```

### Option 3 — mkcert (local CA, persistent)

Creates a trusted certificate for your local IP so you can run the dev server
over HTTPS directly without a tunnel.

```bash
# 1. Install mkcert and add local CA to system trust store
brew install mkcert
mkcert -install

# 2. Generate cert for your local IP
mkcert 192.168.1.11 localhost 127.0.0.1

# 3. Start Next.js with HTTPS
# next.config.ts — add the experimental https option:
# experimental: { https: { key: './192.168.1.11+2-key.pem', cert: './192.168.1.11+2.pem' } }

# Or use a reverse proxy like caddy:
# caddy reverse-proxy --from https://192.168.1.11 --to http://localhost:3001
```

### Option 4 — `--experimental-https` flag (Next.js built-in)

Next.js 15+ supports a built-in self-signed HTTPS mode for development.
A self-signed cert will trigger a browser warning but the page is still
considered a Secure Context after the user accepts the warning.

```bash
next dev --experimental-https
```

---

## Setting Up HTTPS for Production

For any production deployment WebAuthn mandates a real TLS certificate on the
domain users access. Common approaches:

| Approach | Notes |
|---|---|
| **Let's Encrypt** via Caddy / Nginx + certbot | Free, auto-renewing |
| **Cloudflare Proxy** | Free TLS termination for any domain |
| **Cloud provider managed cert** (AWS ACM, GCP Managed SSL, etc.) | Integrates with load balancers |

The backend (`localhost:3000`) does **not** need a public certificate because
the Next.js server proxies or the browser talks to the backend directly via
the same HTTPS origin or a separate API domain.
