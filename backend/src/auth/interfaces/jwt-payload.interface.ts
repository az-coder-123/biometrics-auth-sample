/**
 * JWT token payload structure.
 *
 * Defines the data embedded in JWT tokens for user identification.
 */
export interface JwtPayload {
  sub: string;
  email: string;
}
