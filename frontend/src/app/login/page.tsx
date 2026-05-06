"use client";

/**
 * Login page.
 *
 * Provides email/password login form and a biometric login button
 * for users who have registered biometric credentials.
 */

import { useAuth } from "@/contexts/auth-context";
import { biometricApi } from "@/lib/api-client";
import {
  authenticateWithBiometric,
  isPlatformAuthenticatorAvailable,
} from "@/lib/webauthn";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

/** Storage key for persisted credential IDs per user. */
const CREDENTIAL_STORAGE_PREFIX = "biometrics_cred_ids_";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  // Check biometric availability on mount
  useEffect(() => {
    isPlatformAuthenticatorAvailable().then(setBiometricAvailable);
  }, []);

  /**
   * Handles email/password form submission.
   */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await login({ email, password });
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Handles biometric authentication flow.
   *
   * 1. Request challenge from server
   * 2. Prompt user for biometric (fingerprint/face)
   * 3. Send signed challenge to server for verification
   * 4. Receive JWT token on success
   */
  const handleBiometricLogin = async () => {
    setError("");
    setIsLoading(true);

    try {
      // Step 1: Get challenge from server
      const { challenge } = await biometricApi.generateChallenge();

      // Step 2: Look up stored credential IDs for biometric login
      // In a real app, you might look these up by email or another identifier
      const storedCredIds = localStorage.getItem(
        `${CREDENTIAL_STORAGE_PREFIX}${email}`
      );
      if (!storedCredIds) {
        setError("No biometric credentials found. Please login with password first.");
        setIsLoading(false);
        return;
      }
      const credentialIds = JSON.parse(storedCredIds) as string[];

      // Step 3: Authenticate with biometric (prompts user for fingerprint/face)
      const result = await authenticateWithBiometric(challenge, credentialIds);

      // Step 4: Verify WebAuthn assertion with server
      const verifyResult = await biometricApi.verifySignature({
        credentialId: result.credentialId,
        signature: result.signature,
        authenticatorData: result.authenticatorData,
        clientDataJSON: result.clientDataJSON,
        payload: challenge,
      });

      // Step 5: Store the token
      localStorage.setItem("biometrics_auth_token", verifyResult.accessToken);
      localStorage.setItem("biometrics_auth_user_id", verifyResult.userId);
      localStorage.setItem("biometrics_auth_email", verifyResult.email);

      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Biometric login failed");
    } finally {
      setIsLoading(false);
    }
  };

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
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
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
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
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

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {/* Biometric Login Divider */}
        {biometricAvailable && (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-50 text-gray-500">Or continue with</span>
              </div>
            </div>

            <button
              onClick={handleBiometricLogin}
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-3 py-2 px-4 border border-gray-300 rounded-lg shadow-sm bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 0 0 4.5 10.5a48.667 48.667 0 0 0-1.474 8.25M12 18.75a48.22 48.22 0 0 0-4.272-8.25M12 18.75c1.886 0 3.69-.453 5.292-1.26M12 18.75a48.22 48.22 0 0 1 4.272-8.25M12 2.25c-2.376 0-4.558.67-6.428 1.826M12 2.25c2.376 0 4.558.67 6.428 1.826" />
              </svg>
              Biometric Login
            </button>
          </>
        )}
      </div>
    </div>
  );
}