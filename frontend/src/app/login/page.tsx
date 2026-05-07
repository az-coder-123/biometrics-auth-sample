"use client";

/**
 * Login page.
 *
 * Supports three authentication methods:
 * 1. Email/password login
 * 2. WebAuthn biometric login (desktop browser — requires WebAuthn support)
 * 3. Native biometric login (mobile app WebView — uses JS bridge to query
 *    device biometrics; handles four sub-states: checking / enrolled /
 *    not-enrolled / not-available)
 */

import { useAuth } from "@/contexts/auth-context";
import { useBiometric } from "@/contexts/biometric-context";
import { ApiError, biometricApi } from "@/lib/api-client";
import { BiometricIcon, getBiometricLabel, getBiometricTypeName } from "@/lib/biometric-ui";
import { TOKEN_KEY, WEBAUTHN_CRED_IDS_PREFIX } from "@/lib/storage-keys";
import {
    authenticateWithBiometric,
    isWebAuthnSupported,
} from "@/lib/webauthn";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, useSyncExternalStore } from "react";

export default function LoginPage() {
  const router = useRouter();
  const { login, setTokenFromBiometric } = useAuth();
  const {
    isNativeApp: isNative,
    canAuthenticate,
    isRegistered,
    biometricType,
    loading: nativeChecking,
    loginWithBiometric,
    refreshStatus,
    verifyRegistrationWithBackend,
  } = useBiometric();

  // Detect WebAuthn browser support without hydration mismatch.
  // Server snapshot is false; client snapshot reads the actual browser API.
  const webAuthnAvailable = useSyncExternalStore(
    () => () => {},
    () => isWebAuthnSupported(),
    () => false,
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // When running inside the mobile WebView, refresh biometric status on every
  // login page mount so the button reflects the current device state (e.g.
  // after the user enabled biometrics on the Dashboard and returned here).
  useEffect(() => {
    if (isNative) refreshStatus();
  }, [isNative, refreshStatus]);

  // ---------------------------------------------------------------------------
  // Native WebView biometric state derivation
  //
  //  nativeChecking              — bridge query in progress; show spinner
  //  canAuthenticate && enrolled — device ready; show login button
  //  canAuthenticate && !enrolled — key not created yet; show hint
  //  !canAuthenticate            — device has no biometrics; show nothing
  // ---------------------------------------------------------------------------
  const nativeBiometricChecking   = isNative && nativeChecking;
  const nativeBiometricReady      = isNative && !nativeChecking && canAuthenticate && isRegistered;
  const nativeBiometricNotEnrolled = isNative && !nativeChecking && canAuthenticate && !isRegistered;
  const showNativeSection = isNative && (nativeBiometricChecking || nativeBiometricReady || nativeBiometricNotEnrolled);

  // Browser WebAuthn: show button whenever the browser supports the API.
  const showWebAuthnBiometric = !isNative && webAuthnAvailable;

  // -------------------------------------------------------------------------
  // Email / password login
  // -------------------------------------------------------------------------

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await login({ email, password });
      
      // After successful password login, verify biometric registration
      // to sync state between backend and local device for multi-user scenarios
      if (isNative) {
        const token = localStorage.getItem(TOKEN_KEY);
        if (token) {
          await verifyRegistrationWithBackend(token);
        }
      }
      
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Native biometric login (mobile WebView)
  // -------------------------------------------------------------------------

  const handleNativeBiometricLogin = async () => {
    setError("");
    setIsLoading(true);

    try {
      const result = await loginWithBiometric();

      if (!result.success || !result.accessToken) {
        setError(result.error ?? "Biometric login failed");
        return;
      }

      setTokenFromBiometric({
        accessToken: result.accessToken,
        userId: result.userId ?? "",
        email: result.email ?? "",
      });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Biometric login failed");
    } finally {
      setIsLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // WebAuthn login (desktop browser)
  // -------------------------------------------------------------------------

  /**
   * WebAuthn authentication flow:
   * 1. Validate email is entered (credential IDs are keyed by email)
   * 2. Request challenge from server
   * 3. Look up stored credential IDs for this email
   * 4. Prompt user for biometric via WebAuthn API
   * 5. Send signed assertion to server for verification
   * 6. Store received JWT and redirect to dashboard
   */
  const handleWebAuthnLogin = async () => {
    setError("");

    if (!email) {
      setError("Please enter your email address before using biometric login.");
      return;
    }

    setIsLoading(true);

    try {
      const { challenge } = await biometricApi.generateChallenge();

      const storedCredIds = localStorage.getItem(
        `${WEBAUTHN_CRED_IDS_PREFIX}${email}`,
      );
      if (!storedCredIds) {
        setError("No biometric credentials found for this email. Please sign in with your password first, then enable biometric login from the dashboard.");
        setIsLoading(false);
        return;
      }
      const credentialIds = JSON.parse(storedCredIds) as string[];

      const result = await authenticateWithBiometric(challenge, credentialIds);

      const verifyResult = await biometricApi.verifySignature({
        credentialId: result.credentialId,
        signature: result.signature,
        authenticatorData: result.authenticatorData,
        clientDataJSON: result.clientDataJSON,
        payload: challenge,
      });

      setTokenFromBiometric({
        accessToken: verifyResult.accessToken,
        userId: verifyResult.userId,
        email: verifyResult.email,
      });

      router.push("/dashboard");
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Credential no longer in backend — clean stale localStorage so
        // the UI won't offer biometric login for this email going forward.
        localStorage.removeItem(`${WEBAUTHN_CRED_IDS_PREFIX}${email}`);
        setError(
          "Biometric credential not found. Please sign in with your password and re-register biometrics from the dashboard.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Biometric login failed");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        {/* Header */}
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Or{" "}
            <Link
              href="/register"
              className="font-medium text-indigo-600 hover:text-indigo-500"
            >
              create a new account
            </Link>
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Login Form */}
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700"
              >
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 appearance-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-lg focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {/* ------------------------------------------------------------------ */}
        {/* Native WebView — biometric section                                  */}
        {/* ------------------------------------------------------------------ */}
        {showNativeSection && (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-50 text-gray-500">
                  Or continue with
                </span>
              </div>
            </div>

            {/* Checking bridge — spinner */}
            {nativeBiometricChecking && (
              <div className="w-full flex items-center justify-center gap-3 py-2 px-4 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-400">
                <svg
                  className="animate-spin h-4 w-4 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12" cy="12" r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Checking biometric availability…
              </div>
            )}

            {/* Enrolled — biometric login button */}
            {nativeBiometricReady && (
              <button
                onClick={handleNativeBiometricLogin}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-3 py-2 px-4 border border-gray-300 rounded-lg shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <BiometricIcon type={biometricType} />
                {getBiometricLabel(biometricType, "login")}
              </button>
            )}

            {/* Available but not enrolled — prompt to set up */}
            {nativeBiometricNotEnrolled && (
              <div className="w-full flex items-center gap-3 py-2 px-4 border border-amber-200 rounded-lg bg-amber-50 text-sm text-amber-700">
                <BiometricIcon type={biometricType} className="w-4 h-4 shrink-0 text-amber-500" />
                <span>
                  {getBiometricTypeName(biometricType)} login is not set up.{" "}
                  Sign in with your password, then enable it from your{" "}
                  <strong>Dashboard → Biometric Settings</strong>.
                </span>
              </div>
            )}
          </>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Browser WebAuthn — biometric login button                           */}
        {/* ------------------------------------------------------------------ */}
        {showWebAuthnBiometric && (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-50 text-gray-500">
                  Or continue with
                </span>
              </div>
            </div>

            <button
              onClick={handleWebAuthnLogin}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 py-2 px-4 border border-gray-300 rounded-lg shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <BiometricIcon type={null} />
              WebAuthn Login
            </button>
          </>
        )}
      </div>
    </div>
  );
}
