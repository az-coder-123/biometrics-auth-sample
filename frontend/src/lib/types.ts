/**
 * Type definitions for the Biometrics Auth Frontend.
 *
 * Centralizes all API request/response types and application interfaces
 * to ensure type safety across the application.
 */

// ---------------------------------------------------------------------------
// Auth Types
// ---------------------------------------------------------------------------

/** User registration request payload. */
export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
}

/** User login request payload. */
export interface LoginRequest {
  email: string;
  password: string;
}

/** User data returned from registration or profile. */
export interface User {
  _id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Login response from the backend. */
export interface LoginResponse {
  accessToken: string;
  userId: string;
  email: string;
}

/** Registration response from the backend. */
export interface RegisterResponse {
  message: string;
  user: User;
}

/** Profile response from the backend. */
export interface ProfileResponse {
  userId: string;
  email: string;
}

// ---------------------------------------------------------------------------
// Biometric Types
// ---------------------------------------------------------------------------

/** Biometric credential registration request payload. */
export interface BiometricRegisterRequest {
  userId: string;
  publicKey: string;
  keyAlias?: string;
}

/** Biometric credential data returned from the backend. */
export interface BiometricCredential {
  id: string;
  publicKey: string;
  keyAlias: string;
  createdAt: string;
}

/** Biometric registration response from the backend. */
export interface BiometricRegisterResponse {
  message: string;
  credential: BiometricCredential;
}

/** Challenge response from the backend. */
export interface ChallengeResponse {
  challenge: string;
}

/** Biometric verification request payload. */
export interface BiometricVerifyRequest {
  signature: string;
  publicKey: string;
  payload: string;
}

/** Biometric verification response from the backend. */
export interface BiometricVerifyResponse {
  accessToken: string;
  userId: string;
  email: string;
}

/** Biometric unregistration response from the backend. */
export interface BiometricUnregisterResponse {
  message: string;
}

// ---------------------------------------------------------------------------
// API Wrapper Types
// ---------------------------------------------------------------------------

/** Standard API success response wrapper. */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

/** Standard API error response. */
export interface ApiErrorResponse {
  statusCode: number;
  message: string;
  timestamp: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Application State Types
// ---------------------------------------------------------------------------

/** Authentication context state. */
export interface AuthState {
  isAuthenticated: boolean;
  accessToken: string | null;
  userId: string | null;
  email: string | null;
  isLoading: boolean;
}