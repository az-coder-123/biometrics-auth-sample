"use client";

/**
 * Dashboard page.
 *
 * Displays the authenticated user's profile and provides controls
 * for managing biometric credentials (register and unregister).
 */

import { useAuth } from "@/contexts/auth-context";
import { biometricApi } from "@/lib/api-client";
import {
  generateRandomBuffer,
  isPlatformAuthenticatorAvailable,
  isWebAuthnSupported,
  registerBiometricCredential,
} from "@/lib/webauthn";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

/** Storage key prefix for persisted credential IDs per user. */
const CREDENTIAL_STORAGE_PREFIX = "biometrics_cred_ids_";

export default function DashboardPage() {
  const router = useRouter();
  const { isAuthenticated, accessToken, userId, email, logout } = useAuth();

  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/login");
    }
  }, [isAuthenticated, router]);

  // Check biometric availability
  useEffect(() => {
    if (isWebAuthnSupported()) {
      isPlatformAuthenticatorAvailable().then(setBiometricAvailable);
    }
  }, []);

  // Check if user has stored credentials (derived from localStorage)
  const hasBiometric = useMemo(() => {
    if (!userId || !email) return false;
    const stored = localStorage.getItem(`${CREDENTIAL_STORAGE_PREFIX}${email}`);
    return !!stored;
  }, [userId, email]);

  if (!isAuthenticated) {
    return null;
  }

  /**
   * Registers a new biometric credential for the current user.
   *
   * Flow:
   * 1. Generate a local challenge for WebAuthn registration
   * 2. Create credential via browser WebAuthn API
   * 3. Send the public key to the backend
   * 4. Store the credential ID locally for future authentication
   */
  const handleRegisterBiometric = async () => {
    setError("");
    setMessage("");
    setIsLoading(true);

    try {
      if (!userId || !email) {
        throw new Error("User information not available");
      }

      // Step 1: Generate a challenge for WebAuthn credential creation
      const challenge = generateRandomBuffer();

      // Step 2: Create biometric credential via platform authenticator
      const result = await registerBiometricCredential(
        "Biometrics Auth Sample",
        userId,
        email,
        challenge
      );

      // Step 3: Send the public key to the backend
      await biometricApi.registerCredential({
        userId,
        publicKey: result.publicKey,
        keyAlias: result.credentialId,
      });

      // Step 4: Store credential ID locally for future auth
      const storageKey = `${CREDENTIAL_STORAGE_PREFIX}${email}`;
      const existing = localStorage.getItem(storageKey);
      const credIds = existing ? JSON.parse(existing) : [];
      credIds.push(result.credentialId);
      localStorage.setItem(storageKey, JSON.stringify(credIds));

      setMessage("Biometric credential registered successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register biometric credential");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Removes all biometric credentials for the current user.
   */
  const handleUnregisterBiometric = async () => {
    setError("");
    setMessage("");
    setIsLoading(true);

    try {
      if (!accessToken) {
        throw new Error("Not authenticated");
      }

      await biometricApi.unregisterCredential(accessToken, undefined);

      // Remove stored credential IDs
      if (email) {
        localStorage.removeItem(`${CREDENTIAL_STORAGE_PREFIX}${email}`);
      }

      setMessage("Biometric credential removed successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to unregister biometric credential");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Signs out the current user.
   */
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
          <button
            onClick={handleLogout}
            className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            Sign out
          </button>
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
              Biometric authentication is not available on this device. Please use a device
              with a fingerprint sensor or face recognition support.
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                {hasBiometric
                  ? "Biometric authentication is enabled. You can sign in using your fingerprint or face recognition."
                  : "Register your biometric credential to enable quick sign-in with your fingerprint or face recognition."}
              </p>

              <div className="flex gap-3">
                {!hasBiometric ? (
                  <button
                    onClick={handleRegisterBiometric}
                    disabled={isLoading}
                    className="inline-flex items-center gap-2 py-2 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 0 0 4.5 10.5a48.667 48.667 0 0 0-1.474 8.25" />
                    </svg>
                    {isLoading ? "Registering..." : "Enable Biometric Login"}
                  </button>
                ) : (
                  <button
                    onClick={handleUnregisterBiometric}
                    disabled={isLoading}
                    className="inline-flex items-center gap-2 py-2 px-4 border border-red-300 text-sm font-medium rounded-lg text-red-600 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isLoading ? "Removing..." : "Disable Biometric Login"}
                  </button>
                )}
              </div>

              {hasBiometric && (
                <div className="mt-4 p-3 bg-indigo-50 rounded-lg">
                  <p className="text-xs text-indigo-700">
                    ✅ Biometric credential registered. You can now use the &#34;Biometric Login&#34;
                    button on the sign-in page.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a
              href="/login"
              className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
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
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l-3 3m0 0 3 3m-3-3h12.75" />
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