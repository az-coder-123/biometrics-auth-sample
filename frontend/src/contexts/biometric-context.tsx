"use client";

/**
 * Biometric context provider.
 *
 * Manages biometric authentication state (availability, registration status)
 * and provides methods for biometric registration, login, and unregistration.
 * Follows the flows documented in BIOMETRIC_WEB_INTEGRATION_GUIDE.md.
 *
 * Uses useSyncExternalStore for isNativeApp to avoid hydration mismatches.
 */

import { biometricApi } from "@/lib/api-client";
import { BiometricBridge, isNativeApp } from "@/lib/biometric-bridge";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  useState,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Biometric state tracked by the context. */
interface BiometricState {
  /** Whether running inside the mobile app WebView. */
  isNativeApp: boolean;
  /** Whether the device supports biometric authentication. */
  canAuthenticate: boolean;
  /** Whether biometric keys have been registered on this device. */
  isRegistered: boolean;
  /** The type of biometric available (e.g., "fingerprint", "face"). */
  biometricType: string | null;
  /** Whether the context is still loading initial state. */
  loading: boolean;
}

/** Methods exposed by the biometric context. */
interface BiometricContextType extends BiometricState {
  /** Enables biometric login for the current user. */
  enableBiometric: (userId: string) => Promise<{ success: boolean; error?: string }>;
  /** Authenticates the user via biometric and returns an access token. */
  loginWithBiometric: () => Promise<{
    success: boolean;
    error?: string;
    accessToken?: string;
    userId?: string;
    email?: string;
  }>;
  /** Disables biometric login and removes keys. */
  disableBiometric: () => Promise<void>;
  /** Re-checks biometric availability and registration status. */
  refreshStatus: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const BiometricContext = createContext<BiometricContextType | undefined>(
  undefined,
);

// ---------------------------------------------------------------------------
// isNativeApp via useSyncExternalStore
// ---------------------------------------------------------------------------

/** Subscribe stub — native app status never changes at runtime. */
function subscribeNative(_callback: () => void) {
  return () => {};
}

/** Client snapshot — reads the actual native app status. */
function getNativeSnapshot(): boolean {
  return isNativeApp();
}

/** Server snapshot — always false on server. */
function getNativeServerSnapshot(): boolean {
  return false;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Wraps the application and provides biometric state and methods.
 *
 * Automatically checks device support and key registration status on mount.
 * All operations follow the flows defined in BIOMETRIC_WEB_INTEGRATION_GUIDE.md.
 */
export function BiometricProvider({ children }: { children: ReactNode }) {
  // Use useSyncExternalStore for isNativeApp to avoid hydration mismatch
  const nativeApp = useSyncExternalStore(
    subscribeNative,
    getNativeSnapshot,
    getNativeServerSnapshot,
  );

  // Async biometric state — only meaningful in native app context
  const [asyncState, setAsyncState] = useState<{
    canAuthenticate: boolean;
    isRegistered: boolean;
    biometricType: string | null;
  }>({
    canAuthenticate: false,
    isRegistered: false,
    biometricType: null,
  });

  /** Checks biometric availability and key registration status (native only). */
  const refreshStatus = useCallback(async () => {
    try {
      const [available, keyStatus] = await Promise.all([
        BiometricBridge.checkAvailability(),
        BiometricBridge.keyExists(),
      ]);

      setAsyncState({
        canAuthenticate: available.canAuthenticate,
        isRegistered: keyStatus.exists,
        biometricType: available.availableBiometrics?.[0] ?? null,
      });
    } catch {
      // Keep current state on error
    }
  }, []);

  // Schedule async native biometric checks after initial mount render.
  // Only fires when running inside the mobile WebView.
  useEffect(() => {
    if (!nativeApp) return;
    const id = setTimeout(() => {
      refreshStatus();
    }, 0);
    return () => clearTimeout(id);
  }, [nativeApp, refreshStatus]);

  /**
   * Enables biometric login for the given user.
   *
   * Flow: check availability → delete old keys → create new keys →
   * register public key with backend.
   */
  const enableBiometric = useCallback(
    async (userId: string) => {
      try {
        // 1. Check availability
        const available = await BiometricBridge.checkAvailability();
        if (!available.canAuthenticate) {
          return { success: false, error: "Biometric not available on this device" };
        }

        // 2. Delete old keys if they exist
        const keyStatus = await BiometricBridge.keyExists();
        if (keyStatus.exists) {
          await BiometricBridge.deleteKeys();
        }

        // 3. Create new key pair (prompts user for biometric)
        const createResult = await BiometricBridge.createKeys(
          null,
          "Authenticate to enable biometric login",
        );

        if (!createResult.success || !createResult.publicKey) {
          return {
            success: false,
            error: createResult.error ?? "Failed to create biometric keys",
          };
        }

        // 4. Register public key with backend
        try {
          await biometricApi.registerCredential({
            userId,
            publicKey: createResult.publicKey,
            keyAlias: createResult.keyAlias ?? undefined,
          });

          setAsyncState((prev) => ({
            ...prev,
            isRegistered: true,
          }));
          return { success: true };
        } catch {
          // Backend registration failed — clean up local keys
          await BiometricBridge.deleteKeys();
          return { success: false, error: "Registration failed. Please try again." };
        }
      } catch {
        return { success: false, error: "An unexpected error occurred." };
      }
    },
    [],
  );

  /**
   * Authenticates the user via biometric.
   *
   * Flow: request challenge from backend → sign with biometric →
   * verify signature on backend → receive access token.
   */
  const loginWithBiometric = useCallback(async () => {
    try {
      // 1. Get challenge from backend
      const { challenge } = await biometricApi.generateChallenge();

      // 2. Sign challenge with biometric (prompts user)
      const signResult = await BiometricBridge.sign(
        challenge,
        null,
        "Authenticate to login",
      );

      if (!signResult.success || !signResult.signature) {
        return {
          success: false,
          error: signResult.error ?? "Authentication failed",
        };
      }

      // 3. Verify signature on backend
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

  /**
   * Disables biometric login.
   *
   * Deletes local keys and notifies the backend.
   */
  const disableBiometric = useCallback(async () => {
    try {
      await BiometricBridge.deleteKeys();
    } catch {
      // Best-effort cleanup
    }

    // Notify backend (fire-and-forget, user may not have a token)
    try {
      const token = localStorage.getItem("biometrics_auth_token");
      if (token) {
        await biometricApi.unregisterCredential(token);
      }
    } catch {
      // Silent — backend cleanup is optional
    }

    setAsyncState((prev: { canAuthenticate: boolean; isRegistered: boolean; biometricType: string | null }) => ({
      ...prev,
      isRegistered: false,
    }));
  }, []);

  const value = useMemo(
    () => ({
      isNativeApp: nativeApp,
      canAuthenticate: asyncState.canAuthenticate,
      isRegistered: asyncState.isRegistered,
      biometricType: asyncState.biometricType,
      loading: false,
      enableBiometric,
      loginWithBiometric,
      disableBiometric,
      refreshStatus,
    }),
    [nativeApp, asyncState, enableBiometric, loginWithBiometric, disableBiometric, refreshStatus],
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
 * Hook to access the biometric context.
 *
 * @returns Biometric context value with state and methods
 * @throws Error if used outside of BiometricProvider
 */
export function useBiometric(): BiometricContextType {
  const context = useContext(BiometricContext);
  if (!context) {
    throw Error("useBiometric must be used within a BiometricProvider");
  }
  return context;
}