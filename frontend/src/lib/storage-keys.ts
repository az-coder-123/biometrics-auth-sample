/**
 * Shared localStorage key constants.
 *
 * All keys used to persist state in localStorage are defined here so that
 * every module reads and writes the same strings. Changing a key in one
 * place automatically updates every consumer.
 */

/** JWT access token for the authenticated session. */
export const TOKEN_KEY = "biometrics_auth_token";

/** MongoDB user _id of the authenticated user. */
export const USER_ID_KEY = "biometrics_auth_user_id";

/** Email address of the authenticated user. */
export const EMAIL_KEY = "biometrics_auth_email";

/**
 * Prefix for per-user WebAuthn credential ID lists.
 *
 * Full key = WEBAUTHN_CRED_IDS_PREFIX + email
 * Value    = JSON.stringify(string[])   — array of Base64url credential IDs
 */
export const WEBAUTHN_CRED_IDS_PREFIX = "biometrics_cred_ids_";
