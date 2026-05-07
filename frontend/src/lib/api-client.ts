/**
 * API Client for communicating with the Biometrics Auth Backend.
 *
 * Provides typed methods for all backend endpoints with automatic
 * token management and error handling.
 */

import type {
    ApiResponse,
    BiometricRegisterRequest,
    BiometricRegisterResponse,
    BiometricUnregisterResponse,
    BiometricVerifyRequest,
    BiometricVerifyResponse,
    ChallengeResponse,
    LoginRequest,
    LoginResponse,
    ProfileResponse,
    RegisterRequest,
    RegisterResponse,
} from "./types";

/**
 * Base API URL — must be configured via the NEXT_PUBLIC_API_URL environment variable.
 *
 * @throws Error if the environment variable is not set
 */
const API_BASE_URL = (() => {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    throw new Error(
      "Missing required environment variable: NEXT_PUBLIC_API_URL. " +
      "Please define it in your .env.local file (e.g., NEXT_PUBLIC_API_URL=http://localhost:3000/api)."
    );
  }
  return url;
})();

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/** API error that carries the HTTP status code alongside the message. */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Performs a fetch request with JSON handling and optional auth header.
 *
 * @param endpoint - API endpoint path (e.g., "/auth/login")
 * @param options - Fetch options including method, body, and token
 * @returns Parsed JSON response typed as T
 * @throws ApiError on non-2xx responses
 */
async function request<T>(
  endpoint: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string | null;
  } = {}
): Promise<T> {
  const { method = "GET", body, token } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new ApiError(
      data.message || `Request failed with status ${response.status}`,
      response.status,
    );
  }

  // The backend wraps successful responses in { success, data, timestamp }
  const wrapped = data as ApiResponse<T>;
  return wrapped.data ?? data;
}

// ---------------------------------------------------------------------------
// Auth API
// ---------------------------------------------------------------------------

/** Auth-related API methods. */
export const authApi = {
  /**
   * Registers a new user account.
   *
   * @param payload - Registration form data
   * @returns Created user info
   */
  register(payload: RegisterRequest): Promise<RegisterResponse> {
    return request<RegisterResponse>("/auth/register", {
      method: "POST",
      body: payload,
    });
  },

  /**
   * Authenticates a user with email and password.
   *
   * @param payload - Login credentials
   * @returns JWT access token and user info
   */
  login(payload: LoginRequest): Promise<LoginResponse> {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      body: payload,
    });
  },

  /**
   * Retrieves the authenticated user's profile.
   *
   * @param token - JWT access token
   * @returns User profile data
   */
  getProfile(token: string): Promise<ProfileResponse> {
    return request<ProfileResponse>("/auth/profile", { token });
  },
};

// ---------------------------------------------------------------------------
// Biometric API
// ---------------------------------------------------------------------------

/** Biometric authentication API methods. */
export const biometricApi = {
  /**
   * Checks if the authenticated user has a native biometric credential.
   *
   * @param token - JWT access token
   * @returns Object with hasCredential boolean
   */
  checkNativeCredential(token: string): Promise<{ hasCredential: boolean; keyAlias?: string }> {
    return request<{ hasCredential: boolean; keyAlias?: string }>("/biometric/check", {
      method: "POST",
      token,
    });
  },

  /**
   * Registers a biometric credential for a user.
   *
   * @param payload - Public key and user info
   * @returns Registered credential data
   */
  registerCredential(
    payload: BiometricRegisterRequest
  ): Promise<BiometricRegisterResponse> {
    return request<BiometricRegisterResponse>("/biometric/register", {
      method: "POST",
      body: payload,
    });
  },

  /**
   * Requests a one-time challenge nonce for biometric auth.
   *
   * @returns Challenge string
   */
  generateChallenge(): Promise<ChallengeResponse> {
    return request<ChallengeResponse>("/biometric/challenge", {
      method: "POST",
    });
  },

  /**
   * Verifies a biometric signature and retrieves an access token.
   *
   * @param payload - Signature, public key, and challenge payload
   * @returns JWT access token and user info
   */
  verifySignature(
    payload: BiometricVerifyRequest
  ): Promise<BiometricVerifyResponse> {
    return request<BiometricVerifyResponse>("/biometric/verify", {
      method: "POST",
      body: payload,
    });
  },

  /**
   * Removes a biometric credential for the authenticated user.
   *
   * @param token - JWT access token
   * @param publicKey - Public key of the credential to remove
   * @returns Confirmation message
   */
  unregisterCredential(
    token: string,
    publicKey?: string
  ): Promise<BiometricUnregisterResponse> {
    return request<BiometricUnregisterResponse>("/biometric/unregister", {
      method: "POST",
      token,
      body: publicKey ? { publicKey } : undefined,
    });
  },
};