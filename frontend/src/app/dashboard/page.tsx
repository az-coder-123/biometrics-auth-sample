"use client";

/**
 * Dashboard page.
 *
 * Displays the authenticated user's profile and provides controls
 * for managing biometric credentials. Supports both native biometric
 * (mobile WebView) and WebAuthn (desktop browser).
 */

import { useAuth } from "@/contexts/auth-context";
import { useBiometric } from "@/contexts/biometric-context";
import { biometricApi } from "@/lib/api-client";
import { BiometricIcon, getBiometricLabel, getBiometricTypeName } from "@/lib/biometric-ui";
import { WEBAUTHN_CRED_IDS_PREFIX } from "@/lib/storage-keys";
import {
  generateRandomBuffer,
  isSecureContext,
  isWebAuthnSupported,
  registerBiometricCredential,
} from "@/lib/webauthn";
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, useState } from "react";

/** Subscribe to localStorage changes (cross-tab via storage event). */
const subscribeToStorage = (callback: () => void) => {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
};

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, accessToken, userId, email, logout } = useAuth();
  const {
    isNativeApp: isNative,
    canAuthenticate,
    isRegistered,
    biometricType,
    enableBiometric,
    disableBiometric,
  } = useBiometric();

  // Detect secure context and WebAuthn support without hydration mismatch.
  // Server snapshots are false; client snapshots read actual browser APIs.
  const httpsContext = useSyncExternalStore(
    () => () => {},
    () => isSecureContext(),
    () => false,
  );
  const webAuthnAvailable = useSyncExternalStore(
    () => () => {},
    () => isWebAuthnSupported(),
    () => false,
  );

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Redirect to login if not authenticated (after auth state is resolved)
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/login");
    }
  }, [authLoading, isAuthenticated, router]);

  // Derive the storage key for this user's WebAuthn credential IDs.
  const credStorageKey = `${WEBAUTHN_CRED_IDS_PREFIX}${email ?? ""}`;

  // Track WebAuthn credential registration status via localStorage.
  const webAuthnRegistered = useSyncExternalStore(
    subscribeToStorage,
    () => {
      if (isNative || !email) return false;
      return !!localStorage.getItem(credStorageKey);
    },
    () => false,
  );

  // Show nothing while auth state is loading (matches server render)
  if (authLoading || !isAuthenticated) {
    return null;
  }

  // Determine biometric status for the current runtime environment.
  const biometricAvailable = isNative ? canAuthenticate : webAuthnAvailable;
  const biometricEnabled = isNative ? isRegistered : webAuthnRegistered;

  // -------------------------------------------------------------------------
  // Native Biometric Handlers
  // -------------------------------------------------------------------------

  const handleEnableNativeBiometric = async () => {
    setError("");
    setMessage("");
    setIsLoading(true);

    try {
      if (!userId) throw new Error("User information not available");

      const result = await enableBiometric(userId);

      if (result.success) {
        setMessage("Biometric credential registered successfully!");
      } else {
        setError(result.error ?? "Failed to register biometric credential");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register biometric credential");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisableNativeBiometric = async () => {
    setError("");
    setMessage("");
    setIsLoading(true);

    try {
      await disableBiometric();
      setMessage("Biometric credential removed successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unregister biometric credential");
    } finally {
      setIsLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // WebAuthn Handlers
  // -------------------------------------------------------------------------

  const handleRegisterWebAuthn = async () => {
    setError("");
    setMessage("");
    setIsLoading(true);

    try {
      if (!userId || !email) throw new Error("User information not available");

      const challenge = generateRandomBuffer();
      const result = await registerBiometricCredential(
        "Biometrics Auth Sample",
        userId,
        email,
        challenge,
      );

      await biometricApi.registerCredential({
        userId,
        publicKey: result.publicKey,
        keyAlias: result.credentialId,
      });

      // Append the new credential ID to the per-user list in localStorage.
      const existing = localStorage.getItem(credStorageKey);
      const credIds: string[] = existing ? JSON.parse(existing) : [];
      credIds.push(result.credentialId);
      localStorage.setItem(credStorageKey, JSON.stringify(credIds));

      setMessage("WebAuthn credential registered successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register biometric credential");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnregisterWebAuthn = async () => {
    setError("");
    setMessage("");
    setIsLoading(true);

    try {
      if (!accessToken) throw new Error("Not authenticated");

      await biometricApi.unregisterCredential(accessToken);

      if (email) {
        localStorage.removeItem(credStorageKey);
      }

      setMessage("WebAuthn credential removed successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unregister biometric credential");
    } finally {
      setIsLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Common Handlers
  // -------------------------------------------------------------------------

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          <div className="flex items-center gap-3">
            {isNative && (
              <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded-full">
                Mobile App
              </span>
            )}
            <button
              onClick={handleLogout}
              className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Success Message */}
        {message && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
            {message}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Profile Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Profile</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">User ID</dt>
              <dd className="text-sm font-mono text-gray-900">{userId}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Email</dt>
              <dd className="text-sm text-gray-900">{email}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-gray-500">Status</dt>
              <dd className="text-sm">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  Active
                </span>
              </dd>
            </div>
          </dl>
        </div>

        {/* Biometric Settings Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Biometric Settings
          </h2>

          {!biometricAvailable ? (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 px-4 py-3 rounded-lg text-sm">
              {!isNative && !httpsContext
                ? "WebAuthn requires a secure connection. Please access this app via HTTPS (or localhost for development). Plain HTTP over an IP address is not supported."
                : "Biometric authentication is not available on this device. Please use a device with a fingerprint sensor or face recognition support."}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                {biometricEnabled
                  ? isNative
                    ? `${getBiometricTypeName(biometricType)} authentication is enabled via your device’s secure hardware.`
                    : "WebAuthn biometric authentication is enabled. You can sign in using your browser’s platform authenticator."
                  : isNative
                    ? `Register your ${getBiometricTypeName(biometricType).toLowerCase()} to enable quick sign-in.`
                    : "Register your biometric credential to enable quick sign-in with your browser’s platform authenticator."}
              </p>

              <div className="flex gap-3">
                {!biometricEnabled ? (
                  <button
                    onClick={isNative ? handleEnableNativeBiometric : handleRegisterWebAuthn}
                    disabled={isLoading}
                    className="inline-flex items-center gap-2 py-2 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <BiometricIcon
                      type={isNative ? biometricType : null}
                      className="w-4 h-4"
                    />
                    {isLoading
                      ? "Registering..."
                      : getBiometricLabel(isNative ? biometricType : null, "enable")}
                  </button>
                ) : (
                  <button
                    onClick={isNative ? handleDisableNativeBiometric : handleUnregisterWebAuthn}
                    disabled={isLoading}
                    className="inline-flex items-center gap-2 py-2 px-4 border border-red-300 text-sm font-medium rounded-lg text-red-600 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isLoading
                      ? "Removing..."
                      : getBiometricLabel(isNative ? biometricType : null, "disable")}
                  </button>
                )}
              </div>

              {biometricEnabled && (
                <div className="mt-4 p-3 bg-indigo-50 rounded-lg">
                  <p className="text-xs text-indigo-700">
                    ✅{" "}
                    {isNative
                      ? `${getBiometricTypeName(biometricType)} credential registered via secure hardware.`
                      : "WebAuthn credential registered via platform authenticator."}{" "}
                    {"You can now use the biometric login button on the sign-in page."}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Quick Actions
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a
              href="/login"
              className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              <svg
                className="w-5 h-5 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-gray-900">Test Login</p>
                <p className="text-xs text-gray-500">Go to the login page</p>
              </div>
            </a>
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors text-left"
            >
              <svg
                className="w-5 h-5 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75"
                />
              </svg>
              <div>
                <p className="text-sm font-medium text-gray-900">Sign Out</p>
                <p className="text-xs text-gray-500">End your session</p>
              </div>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
