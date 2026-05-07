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
  if (typeof window === "undefined") {
    console.debug('[BiometricBridge] SSR context - window is undefined');
    return false;
  }
  
  const hasFlutterBridge = typeof window.flutter_inappwebview !== "undefined";
  
  console.debug('[BiometricBridge] isNativeApp check:', {
    hasFlutterBridge,
    bridgeObject: window.flutter_inappwebview ? 'exists' : 'missing',
    callHandler: window.flutter_inappwebview?.callHandler ? 'exists' : 'missing',
    platformReady: window.flutter_inappwebview?._platformReady ?? 'not set'
  });
  
  return hasFlutterBridge;
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
 * Resolves after a timeout to avoid blocking forever.
 * 
 * @param timeoutMs - Maximum time to wait (default: 3000ms)
 */
export function waitForBridgeReady(timeoutMs: number = 3000): Promise<void> {
  console.log('[BiometricBridge] waitForBridgeReady called');
  
  if (typeof window === "undefined") {
    console.log('[BiometricBridge] SSR - resolving immediately');
    return Promise.resolve();
  }
  
  if (isBridgeReady()) {
    console.log('[BiometricBridge] Bridge already ready');
    return Promise.resolve();
  }
  
  if (bridgeReadyPromise) {
    console.log('[BiometricBridge] Returning existing promise');
    return bridgeReadyPromise;
  }

  console.log('[BiometricBridge] Starting to wait for bridge ready event...');
  
  bridgeReadyPromise = new Promise((resolve) => {
    let timerId: number | null = null;

    const onReady = () => {
      console.log('[BiometricBridge] ✅ Platform ready event received!');
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

    // Check periodically if bridge became available
    let checkCount = 0;
    const maxChecks = Math.ceil(timeoutMs / 100);
    
    const checkBridge = () => {
      checkCount++;
      
      const hasCallHandler = !!window.flutter_inappwebview?.callHandler;
      const platformReady = window.flutter_inappwebview?._platformReady === true;
      
      console.log(`[BiometricBridge] Check ${checkCount}/${maxChecks}:`, {
        hasCallHandler,
        platformReady,
        bridgeExists: !!window.flutter_inappwebview
      });
      
      if (hasCallHandler && platformReady) {
        console.log('[BiometricBridge] ✅ Bridge ready via polling!');
        bridgeReady = true;
        cleanup();
        resolve();
        return;
      }
      
      if (checkCount >= maxChecks) {
        // Final check before timeout
        if (hasCallHandler) {
          bridgeReady = true;
          console.warn('[BiometricBridge] ⚠️ Platform ready event not received, but bridge exists - proceeding anyway');
        } else {
          console.error('[BiometricBridge] ❌ Bridge not ready after timeout - no callHandler found!');
        }
        cleanup();
        resolve();
      } else {
        timerId = window.setTimeout(checkBridge, 100);
      }
    };

    // Listen for the ready event (preferred path)
    window.addEventListener(BRIDGE_READY_EVENT, onReady, { once: true });
    
    // Start periodic checking as fallback
    timerId = window.setTimeout(checkBridge, 100);
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
  console.log(`[BiometricBridge] callHandler('${handlerName}') called with args:`, args);
  
  if (!isNativeApp()) {
    const error = `Cannot call '${handlerName}': not running inside the mobile app WebView.`;
    console.error(`[BiometricBridge] ${error}`);
    throw new Error(error);
  }

  console.log(`[BiometricBridge] Waiting for bridge ready before calling '${handlerName}'...`);
  await waitForBridgeReady();

  const bridge = window.flutter_inappwebview;
  if (!bridge?.callHandler) {
    const error = `Cannot call '${handlerName}': native bridge is not ready.`;
    console.error(`[BiometricBridge] ${error}`, {
      bridgeExists: !!bridge,
      hasCallHandler: !!bridge?.callHandler
    });
    throw new Error(error);
  }

  console.log(`[BiometricBridge] Calling native handler '${handlerName}'...`);
  
  try {
    const result = await bridge.callHandler(handlerName, ...args) as Promise<T>;
    console.log(`[BiometricBridge] ✅ Handler '${handlerName}' returned:`, result);
    return result;
  } catch (error) {
    console.error(`[BiometricBridge] ❌ Handler '${handlerName}' failed:`, error);
    throw error;
  }
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
    console.debug('[BiometricBridge] Calling checkAvailability');
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

  /**
   * Sets the active user context on the native side.
   *
   * Scopes all subsequent biometric key operations (create, sign, delete)
   * to this user's keys. Call after every successful login — both password
   * login and biometric login — so the native layer always knows which
   * user's key to use on a shared device.
   *
   * @param userId - The authenticated user's ID
   */
  setCurrentUser(userId: string): Promise<{ success: boolean }> {
    return callHandler<{ success: boolean }>("setCurrentUser", userId);
  },
} as const;