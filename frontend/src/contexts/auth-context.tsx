"use client";

/**
 * Authentication context provider.
 *
 * Manages user authentication state (JWT token, user info) and
 * provides login/logout/register methods to child components.
 * Persists the token in localStorage for session persistence.
 */

import { authApi } from "@/lib/api-client";
import type { AuthState, LoginRequest, RegisterRequest } from "@/lib/types";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------

const TOKEN_KEY = "biometrics_auth_token";
const USER_ID_KEY = "biometrics_auth_user_id";
const EMAIL_KEY = "biometrics_auth_email";

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Wraps the application and provides authentication state and methods.
 *
 * @param children - Child components that will have access to auth state
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  // Lazily initialize state from localStorage (client-side only).
  // This avoids the ESLint rule about calling setState in useEffect
  // while still handling SSR correctly.
  const [state, setState] = useState<AuthState>(() => {
    // During SSR, return loading state — hydration will resolve on client
    if (typeof window === "undefined") {
      return {
        isAuthenticated: false,
        accessToken: null,
        userId: null,
        email: null,
        isLoading: true,
      };
    }

    // On client, read persisted credentials from localStorage
    const token = localStorage.getItem(TOKEN_KEY);
    const userId = localStorage.getItem(USER_ID_KEY);
    const email = localStorage.getItem(EMAIL_KEY);

    if (token && userId) {
      return {
        isAuthenticated: true,
        accessToken: token,
        userId,
        email,
        isLoading: false,
      };
    }

    return {
      isAuthenticated: false,
      accessToken: null,
      userId: null,
      email: null,
      isLoading: false,
    };
  });

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

    setState({
      isAuthenticated: true,
      accessToken: loginResult.accessToken,
      userId: loginResult.userId,
      email: loginResult.email,
      isLoading: false,
    });
  }, []);

  /** Authenticates a user and stores the resulting token. */
  const login = useCallback(async (data: LoginRequest) => {
    const result = await authApi.login(data);

    localStorage.setItem(TOKEN_KEY, result.accessToken);
    localStorage.setItem(USER_ID_KEY, result.userId);
    localStorage.setItem(EMAIL_KEY, result.email);

    setState({
      isAuthenticated: true,
      accessToken: result.accessToken,
      userId: result.userId,
      email: result.email,
      isLoading: false,
    });
  }, []);

  /** Clears the authentication state and stored token. */
  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(EMAIL_KEY);

    setState({
      isAuthenticated: false,
      accessToken: null,
      userId: null,
      email: null,
      isLoading: false,
    });
  }, []);

  const value = useMemo(
    () => ({ ...state, register, login, logout }),
    [state, register, login, logout]
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