"use client";

/**
 * Biometric context provider.
 *
 * Manages biometric authentication state and provides methods for
 * biometric registration, login, and unregistration.
 *
 * Two runtime modes are supported:
 *   - Native (Flutter WebView) — uses BiometricBridge → device secure hardware
 *   - Browser (WebAuthn)       — handled directly in the page components;
 *                                this context only exposes `isNativeApp` so
 *                                pages can branch their logic.
 *
 * Uses useSyncExternalStore for `isNativeApp` to avoid SSR hydration mismatches.
 */

import { biometricApi } from "@/lib/api-client";
import { BiometricBridge, isNativeApp } from "@/lib/biometric-bridge";
import { TOKEN_KEY } from "@/lib/storage-keys";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Biometric state tracked by the context. */
interface BiometricState {
  /** Whether running inside the mobile app WebView. */
  isNativeApp: boolean;
  /** Whether the device supports biometric authentication (native only). */
  canAuthenticate: boolean;
  /** Whether biometrics are enrolled on the device (native only). */
  hasEnrolledBiometrics: boolean;
  /** Whether biometric keys have been registered on this device (native only). */
  isRegistered: boolean;
  /** The primary biometric type available, e.g. "fingerprint" | "face" | "iris" (native only). */
  biometricType: string | null;
  /** All biometric types available on the device (native only). */
  availableBiometrics: string[];
  /** True while the initial native availability check is in progress. */
  loading: boolean;
}

/** Methods exposed by the biometric context. */
interface BiometricContextType extends BiometricState {
  /** Enables native biometric login for the given user. No-op in browser. */
  enableBiometric: (userId: string) => Promise<{ success: boolean; error?: string }>;
  /** Authenticates via native biometric and returns an access token. No-op in browser. */
  loginWithBiometric: () => Promise<{
    success: boolean;
    error?: string;
    accessToken?: string;
    userId?: string;
    email?: string;
  }>;
  /** Disables native biometric login and removes keys. No-op in browser. */
  disableBiometric: () => Promise<void>;
  /** Re-checks native biometric availability and registration status. No-op in browser. */
  refreshStatus: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const BiometricContext = createContext<BiometricContextType | undefined>(
  undefined,
);

// ---------------------------------------------------------------------------
// useSyncExternalStore helpers for isNativeApp
// ---------------------------------------------------------------------------

/** Subscribe stub — native-app status never changes during a session. */
function subscribeNative(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener("flutterInAppWebViewPlatformReady", handler);
  return () => window.removeEventListener("flutterInAppWebViewPlatformReady", handler);
}

/** Client snapshot — reads the actual bridge presence. */
function getNativeSnapshot(): boolean {
  return isNativeApp();
}

/** Server snapshot — always false; bridge is not available during SSR. */
function getNativeServerSnapshot(): boolean {
  return false;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function BiometricProvider({ children }: { children: ReactNode }) {
  const nativeApp = useSyncExternalStore(
    subscribeNative,
    getNativeSnapshot,
    getNativeServerSnapshot,
  );

  const [asyncState, setAsyncState] = useState({
    canAuthenticate: false,
    hasEnrolledBiometrics: false,
    isRegistered: false,
    biometricType: null as string | null,
    availableBiometrics: [] as string[],
  });

  // `checkedOnce` tracks whether the first bridge availability check has
  // completed. We derive `loading` from `nativeApp && !checkedOnce` so that:
  //   - In WebView: loading is true immediately (nativeApp=true, checkedOnce=false)
  //   - After first check: loading becomes false (checkedOnce=true)
  //   - In browser: loading stays false (nativeApp=false)
  // This avoids calling setState directly in an effect body.
  const [checkedOnce, setCheckedOnce] = useState(false);

  // ---------------------------------------------------------------------------
  // refreshStatus — native only
  // ---------------------------------------------------------------------------

  /**
   * Queries the native bridge for biometric availability and key status.
   * Safe to call from any context — silently returns when not in native app.
   */
  const refreshStatus = useCallback(async () => {
    if (!isNativeApp()) return;

    try {
      const [available, keyStatus] = await Promise.all([
        BiometricBridge.checkAvailability(),
        BiometricBridge.keyExists(),
      ]);

      const biometrics = available.availableBiometrics ?? [];
      setAsyncState({
        canAuthenticate: available.canAuthenticate,
        hasEnrolledBiometrics: available.hasEnrolledBiometrics,
        isRegistered: keyStatus.exists,
        biometricType: biometrics[0] ?? null,
        availableBiometrics: biometrics,
      });
    } catch {
      // Keep current state on bridge error
    } finally {
      setCheckedOnce(true);
    }
  }, []);

  // Run initial native check after first render inside the WebView.
  useEffect(() => {
    if (!nativeApp) return;
    const id = setTimeout(refreshStatus, 0);
    return () => clearTimeout(id);
  }, [nativeApp, refreshStatus]);

  // ---------------------------------------------------------------------------
  // enableBiometric — native only
  // ---------------------------------------------------------------------------

  /**
   * Enrolls a biometric credential for the given user.
   *
   * Flow: check availability → delete stale keys → create new key pair
   *       (triggers biometric prompt) → register public key with backend.
   */
  const enableBiometric = useCallback(async (userId: string) => {
    if (!isNativeApp()) {
      return { success: false, error: "Native biometric is only available inside the mobile app." };
    }

    try {
      const available = await BiometricBridge.checkAvailability();
      if (!available.canAuthenticate) {
        return { success: false, error: "Biometric not available on this device." };
      }

      const keyStatus = await BiometricBridge.keyExists();
      if (keyStatus.exists) {
        await BiometricBridge.deleteKeys();
      }

      const createResult = await BiometricBridge.createKeys(
        null,
        "Authenticate to enable biometric login",
      );

      if (!createResult.success || !createResult.publicKey) {
        return {
          success: false,
          error: createResult.error ?? "Failed to create biometric keys.",
        };
      }

      try {
        await biometricApi.registerCredential({
          userId,
          publicKey: createResult.publicKey,
          keyAlias: createResult.keyAlias ?? undefined,
        });

        setAsyncState((prev) => ({
          ...prev,
          isRegistered: true,
          hasEnrolledBiometrics: true,
        }));
        return { success: true };
      } catch {
        // Backend registration failed — remove the newly created local keys
        await BiometricBridge.deleteKeys();
        return { success: false, error: "Registration failed. Please try again." };
      }
    } catch {
      return { success: false, error: "An unexpected error occurred." };
    }
  }, []);

  // ---------------------------------------------------------------------------
  // loginWithBiometric — native only
  // ---------------------------------------------------------------------------

  /**
   * Authenticates the user via the native biometric bridge.
   *
   * Flow: request challenge from backend → sign with biometric
   *       → verify signature on backend → return access token.
   */
  const loginWithBiometric = useCallback(async () => {
    if (!isNativeApp()) {
      return { success: false, error: "Native biometric is only available inside the mobile app." };
    }

    try {
      const { challenge } = await biometricApi.generateChallenge();

      const signResult = await BiometricBridge.sign(
        challenge,
        null,
        "Authenticate to login",
      );

      if (!signResult.success || !signResult.signature) {
        return {
          success: false,
          error: signResult.error ?? "Authentication failed.",
        };
      }

      const verifyResult = await biometricApi.verifySignature({
        signature: signResult.signature,
        publicKey: signResult.publicKey ?? "",
        payload: signResult.payload ?? challenge,
      });

      return {
        success: true,
        accessToken: verifyResult.accessToken,
        userId: verifyResult.userId,
        email: verifyResult.email,
      };
    } catch {
      return { success: false, error: "Login failed. Please try again." };
    }
  }, []);

  // ---------------------------------------------------------------------------
  // disableBiometric — native only
  // ---------------------------------------------------------------------------

  /**
   * Removes biometric credentials from both the device and the backend.
   * Safe to call from any context — silently returns when not in native app.
   */
  const disableBiometric = useCallback(async () => {
    if (!isNativeApp()) return;

    try {
      await BiometricBridge.deleteKeys();
    } catch {
      // Best-effort local cleanup
    }

    // Notify backend (fire-and-forget — user may not have a valid token)
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      if (token) {
        await biometricApi.unregisterCredential(token);
      }
    } catch {
      // Silent — backend credential removal is best-effort
    }

    setAsyncState((prev) => ({ ...prev, isRegistered: false }));
  }, []);

  // ---------------------------------------------------------------------------
  // Context value
  // ---------------------------------------------------------------------------

  const value = useMemo(
    () => ({
      isNativeApp: nativeApp,
      canAuthenticate: asyncState.canAuthenticate,
      hasEnrolledBiometrics: asyncState.hasEnrolledBiometrics,
      isRegistered: asyncState.isRegistered,
      biometricType: asyncState.biometricType,
      availableBiometrics: asyncState.availableBiometrics,
      loading: nativeApp && !checkedOnce,
      enableBiometric,
      loginWithBiometric,
      disableBiometric,
      refreshStatus,
    }),
    [nativeApp, asyncState, checkedOnce, enableBiometric, loginWithBiometric, disableBiometric, refreshStatus],
  );

  return (
    <BiometricContext.Provider value={value}>
      {children}
    </BiometricContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns the biometric context value.
 * Must be used inside a BiometricProvider.
 */
export function useBiometric(): BiometricContextType {
  const context = useContext(BiometricContext);
  if (!context) {
    throw new Error("useBiometric must be used within a BiometricProvider");
  }
  return context;
}
