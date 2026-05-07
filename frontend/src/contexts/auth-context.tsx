"use client";

/**
 * Authentication context provider.
 *
 * Manages user authentication state (JWT token, user info) and
 * provides login/logout/register methods to child components.
 * Persists the token in localStorage for session persistence.
 *
 * Uses useSyncExternalStore to avoid hydration mismatches:
 * - Server: returns a loading snapshot (isLoading: true)
 * - Client hydration: also uses the server snapshot, so HTML matches
 * - After hydration: reads from localStorage and updates
 */

import { authApi } from "@/lib/api-client";
import { BiometricBridge, isNativeApp } from "@/lib/biometric-bridge";
import { EMAIL_KEY, TOKEN_KEY, USER_ID_KEY } from "@/lib/storage-keys";
import type { AuthState, LoginRequest, RegisterRequest } from "@/lib/types";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

// ---------------------------------------------------------------------------
// Context Type
// ---------------------------------------------------------------------------

interface AuthContextType extends AuthState {
  /** Registers a new user and stores the resulting token. */
  register: (data: RegisterRequest) => Promise<void>;
  /** Authenticates a user and stores the resulting token. */
  login: (data: LoginRequest) => Promise<void>;
  /** Clears the authentication state and stored token. */
  logout: () => void;
  /**
   * Stores a token obtained from biometric verification.
   *
   * Used by both WebAuthn and native biometric login flows to update
   * the auth context state after successful signature verification.
   */
  setTokenFromBiometric: (data: {
    accessToken: string;
    userId: string;
    email: string;
  }) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// useSyncExternalStore for Auth State
// ---------------------------------------------------------------------------

/** Server snapshot — used during SSR and hydration to avoid mismatches. */
const SERVER_SNAPSHOT: AuthState = {
  isAuthenticated: false,
  accessToken: null,
  userId: null,
  email: null,
  isLoading: true,
};

/** Module-level cache for stable client snapshot references. */
let _cacheKey = "";
let _cachedSnapshot: AuthState = {
  isAuthenticated: false,
  accessToken: null,
  userId: null,
  email: null,
  isLoading: false,
};

/** Reads auth state from localStorage (client-only). */
function getSnapshot(): AuthState {
  const token = localStorage.getItem(TOKEN_KEY);
  const userId = localStorage.getItem(USER_ID_KEY);
  const email = localStorage.getItem(EMAIL_KEY);

  const key = `${token ?? ""}|${userId ?? ""}|${email ?? ""}`;
  if (key !== _cacheKey) {
    _cacheKey = key;
    if (token && userId) {
      _cachedSnapshot = {
        isAuthenticated: true,
        accessToken: token,
        userId,
        email,
        isLoading: false,
      };
    } else {
      _cachedSnapshot = {
        isAuthenticated: false,
        accessToken: null,
        userId: null,
        email: null,
        isLoading: false,
      };
    }
  }
  return _cachedSnapshot;
}

/** Returns the server snapshot (no localStorage access). */
function getServerSnapshot(): AuthState {
  return SERVER_SNAPSHOT;
}

/**
 * Subscribes to auth store changes.
 * Listens to both cross-tab `storage` events and same-tab `auth-change` events.
 */
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("auth-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("auth-change", callback);
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Wraps the application and provides authentication state and methods.
 *
 * @param children - Child components that will have access to auth state
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /** Registers a new user and stores the resulting token. */
  const register = useCallback(async (data: RegisterRequest) => {
    await authApi.register(data);
    // After registration, auto-login to get a token
    const loginResult = await authApi.login({
      email: data.email,
      password: data.password,
    });

    localStorage.setItem(TOKEN_KEY, loginResult.accessToken);
    localStorage.setItem(USER_ID_KEY, loginResult.userId);
    localStorage.setItem(EMAIL_KEY, loginResult.email);
    window.dispatchEvent(new Event("auth-change"));
    if (isNativeApp()) {
      BiometricBridge.setCurrentUser(loginResult.userId).catch(() => {});
    }
  }, []);

  /** Authenticates a user and stores the resulting token. */
  const login = useCallback(async (data: LoginRequest) => {
    const result = await authApi.login(data);

    localStorage.setItem(TOKEN_KEY, result.accessToken);
    localStorage.setItem(USER_ID_KEY, result.userId);
    localStorage.setItem(EMAIL_KEY, result.email);
    window.dispatchEvent(new Event("auth-change"));
    if (isNativeApp()) {
      BiometricBridge.setCurrentUser(result.userId).catch(() => {});
    }
  }, []);

  /** Stores a token from biometric verification into context and localStorage. */
  const setTokenFromBiometric = useCallback(
    (data: { accessToken: string; userId: string; email: string }) => {
      localStorage.setItem(TOKEN_KEY, data.accessToken);
      localStorage.setItem(USER_ID_KEY, data.userId);
      localStorage.setItem(EMAIL_KEY, data.email);
      window.dispatchEvent(new Event("auth-change"));
    },
    [],
  );

  /** Clears the authentication state and stored token. */
  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(EMAIL_KEY);
    window.dispatchEvent(new Event("auth-change"));
  }, []);

  const value = useMemo(
    () => ({ ...state, register, login, logout, setTokenFromBiometric }),
    [state, register, login, logout, setTokenFromBiometric],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook to access the authentication context.
 *
 * @returns Auth context value with state and methods
 * @throws Error if used outside of AuthProvider
 */
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}