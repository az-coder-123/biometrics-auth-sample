/**
 * Biometric Bridge — Native WebView communication layer.
 *
 * Provides a typed API for calling biometric handlers registered by the
 * mobile app's InAppWebView JavaScript bridge. All method signatures and
 * return shapes match the contract in BIOMETRIC_WEB_INTEGRATION_GUIDE.md.
 *
 * Usage:
 * ```ts
 * import { BiometricBridge } from '@/lib/biometric-bridge';
 *
 * const available = await BiometricBridge.checkAvailability();
 * if (available.canAuthenticate) { ... }
 * ```
 */

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/** Result of checking biometric availability on the device. */
export interface BiometricAvailability {
  success: boolean;
  canAuthenticate: boolean;
  hasEnrolledBiometrics: boolean;
  availableBiometrics: string[];
  reason?: string | null;
}

/** Result of checking if biometric keys exist. */
export interface KeyExistsResult {
  exists: boolean;
  keyAlias: string | null;
  valid: boolean;
}

/** Result of creating a new biometric key pair. */
export interface CreateKeysResult {
  success: boolean;
  publicKey?: string;
  keyAlias?: string | null;
  error?: string;
  code?: string;
}

/** Result of signing a payload with biometric authentication. */
export interface SignResult {
  success: boolean;
  authenticated: boolean;
  signature?: string;
  publicKey?: string;
  payload?: string;
  keyAlias?: string | null;
  ts?: string;
  error?: string;
  code?: string;
}

/** Result of a simple biometric prompt (no cryptography). */
export interface SimplePromptResult {
  success: boolean;
  authenticated: boolean;
  error?: string;
  code?: string;
}

/** Detailed key information from the secure hardware. */
export interface KeyInfoResult {
  exists: boolean;
  keyAlias: string | null;
  valid: boolean;
  publicKey?: string | null;
  algorithm?: string | null;
  keySize?: number | null;
}

// ---------------------------------------------------------------------------
// Bridge Detection
// ---------------------------------------------------------------------------

/**
 * Checks whether the code is running inside the mobile app WebView.
 *
 * When the InAppWebView Flutter plugin is active, it injects the
 * `flutter_inappwebview` object onto `window`.
 */
export function isNativeApp(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.flutter_inappwebview !== "undefined"
  );
}

const BRIDGE_READY_EVENT = "flutterInAppWebViewPlatformReady";
let bridgeReady = false;
let bridgeReadyPromise: Promise<void> | null = null;

/**
 * Checks whether the WebView bridge has finished platform initialization.
 */
export function isBridgeReady(): boolean {
  if (bridgeReady) return true;
  if (typeof window === "undefined") return false;
  if (window.flutter_inappwebview?._platformReady === true) {
    bridgeReady = true;
    return true;
  }
  return false;
}

/**
 * Waits for the WebView bridge to signal readiness.
 * Resolves after a short timeout to avoid blocking forever.
 */
export function waitForBridgeReady(timeoutMs: number = 1500): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (isBridgeReady()) return Promise.resolve();
  if (bridgeReadyPromise) return bridgeReadyPromise;

  bridgeReadyPromise = new Promise((resolve) => {
    let timerId: number | null = null;

    const onReady = () => {
      bridgeReady = true;
      cleanup();
      resolve();
    };

    const cleanup = () => {
      window.removeEventListener(BRIDGE_READY_EVENT, onReady);
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
      bridgeReadyPromise = null;
    };

    timerId = window.setTimeout(() => {
      if (window.flutter_inappwebview?.callHandler) {
        bridgeReady = true;
      }
      cleanup();
      resolve();
    }, timeoutMs);

    window.addEventListener(BRIDGE_READY_EVENT, onReady, { once: true });
  });

  return bridgeReadyPromise;
}

// ---------------------------------------------------------------------------
// Call Helper
// ---------------------------------------------------------------------------

/**
 * Calls a native JavaScript bridge handler.
 *
 * @param handlerName - The registered handler name (e.g. 'biometricAuthAvailable')
 * @param args - Positional arguments forwarded to the native handler
 * @returns Parsed result from the native side
 */
async function callHandler<T>(
  handlerName: string,
  ...args: unknown[]
): Promise<T> {
  if (!isNativeApp()) {
    throw new Error(
      `Cannot call '${handlerName}': not running inside the mobile app WebView.`,
    );
  }

  await waitForBridgeReady();

  const bridge = window.flutter_inappwebview;
  if (!bridge?.callHandler) {
    throw new Error(
      `Cannot call '${handlerName}': native bridge is not ready.`,
    );
  }

  return bridge.callHandler(handlerName, ...args) as Promise<T>;
}

// ---------------------------------------------------------------------------
// BiometricBridge API
// ---------------------------------------------------------------------------

/**
 * Static API class for biometric operations via the native bridge.
 *
 * Each method maps to a handler registered in the mobile app's
 * `JsBridgeService`. Method names and return types are documented in
 * `BIOMETRIC_WEB_INTEGRATION_GUIDE.md`.
 */
export const BiometricBridge = {
  /**
   * Checks whether biometric authentication is available on this device.
   */
  checkAvailability(): Promise<BiometricAvailability> {
    return callHandler<BiometricAvailability>("biometricAuthAvailable");
  },

  /**
   * Creates a hardware-backed biometric key pair.
   * Prompts the user for biometric authentication.
   *
   * @param keyAlias - Optional key alias (null = default)
   * @param reason - Optional prompt message
   */
  createKeys(keyAlias?: string | null, reason?: string): Promise<CreateKeysResult> {
    return callHandler<CreateKeysResult>(
      "biometricCreateKeys",
      keyAlias ?? null,
      reason ?? null,
    );
  },

  /**
   * Signs a payload using the biometric-backed private key.
   * Prompts the user for biometric authentication.
   *
   * @param payload - The challenge nonce from the server (required)
   * @param keyAlias - Optional key alias
   * @param reason - Optional prompt message
   */
  sign(
    payload: string,
    keyAlias?: string | null,
    reason?: string,
  ): Promise<SignResult> {
    return callHandler<SignResult>(
      "biometricSign",
      payload,
      keyAlias ?? null,
      reason ?? null,
    );
  },

  /**
   * Checks if biometric keys exist on the device.
   */
  keyExists(keyAlias?: string | null): Promise<KeyExistsResult> {
    return callHandler<KeyExistsResult>("biometricKeyExists", keyAlias ?? null);
  },

  /**
   * Gets detailed information about the biometric key.
   */
  getKeyInfo(keyAlias?: string | null): Promise<KeyInfoResult> {
    return callHandler<KeyInfoResult>("biometricGetKeyInfo", keyAlias ?? null);
  },

  /**
   * Deletes biometric keys for a specific alias.
   */
  deleteKeys(keyAlias?: string | null): Promise<{ success: boolean }> {
    return callHandler<{ success: boolean }>(
      "biometricDeleteKeys",
      keyAlias ?? null,
    );
  },

  /**
   * Deletes all biometric keys on the device.
   */
  deleteAllKeys(): Promise<{ success: boolean }> {
    return callHandler<{ success: boolean }>("biometricDeleteAllKeys");
  },

  /**
   * Shows a simple biometric prompt without cryptographic operations.
   */
  simplePrompt(message: string): Promise<SimplePromptResult> {
    return callHandler<SimplePromptResult>(
      "biometricSimplePrompt",
      message,
    );
  },
} as const;