/**
 * Biometric UI helpers.
 *
 * Maps a biometric type string (returned by the native bridge's
 * `biometricAuthAvailable` handler) to the appropriate SVG icon
 * and human-readable label.
 *
 * Supported type strings from the `biometric_signature` Flutter package:
 *   "fingerprint" — Touch ID / Android fingerprint sensor
 *   "face"        — Face ID (iOS) / Android face recognition
 *   "iris"        — Iris scanner (some Android devices)
 *   "strong"      — Android BIOMETRIC_STRONG (may be fingerprint or face)
 *   "weak"        — Android BIOMETRIC_WEAK
 *   null          — Unknown / WebAuthn fallback
 */

// ---------------------------------------------------------------------------
// Label helper
// ---------------------------------------------------------------------------

/**
 * Returns a human-readable display name for the given biometric type.
 *
 * @param type  - Biometric type string from the native bridge, or null.
 */
export function getBiometricTypeName(type: string | null): string {
  switch (type) {
    case "face":        return "Face ID";
    case "fingerprint": return "Fingerprint";
    case "iris":        return "Iris";
    default:            return "Biometric";
  }
}

/**
 * Returns the full button label for a given action context.
 *
 * @param type    - Biometric type string from the native bridge, or null.
 * @param action  - "login" | "enable" | "disable"
 */
export function getBiometricLabel(
  type: string | null,
  action: "login" | "enable" | "disable" = "login",
): string {
  const name = getBiometricTypeName(type);
  switch (action) {
    case "enable":  return `Enable ${name} Login`;
    case "disable": return `Disable ${name} Login`;
    default:        return `${name} Login`;
  }
}

// ---------------------------------------------------------------------------
// Icon component
// ---------------------------------------------------------------------------

interface BiometricIconProps {
  /** Biometric type string from the native bridge, or null for generic. */
  type: string | null;
  className?: string;
}

/**
 * Renders the SVG icon that matches the biometric type:
 *   "fingerprint" / "strong" / "weak" / null → fingerprint spiral
 *   "face"                                   → smiling face circle
 *   "iris"                                   → eye outline
 *
 * Drop it anywhere inside an SVG-capable context; it renders its own <svg>.
 */
export function BiometricIcon({ type, className = "w-5 h-5" }: BiometricIconProps) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden="true"
    >
      {renderPaths(type)}
    </svg>
  );
}

function renderPaths(type: string | null) {
  // Face ID / face recognition
  if (type === "face") {
    return (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.182 15.182a4.5 4.5 0 0 1-6.364 0M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75Zm-.375 0h.008v.015h-.008V9.75Z"
      />
    );
  }

  // Iris scanner
  if (type === "iris") {
    return (
      <>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
        />
      </>
    );
  }

  // Fingerprint (default — covers "fingerprint", "strong", "weak", null)
  return (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 0 0 4.5 10.5a48.667 48.667 0 0 0-1.474 8.25M12 18.75a48.22 48.22 0 0 0-4.272-8.25M12 18.75c1.886 0 3.69-.453 5.292-1.26M12 18.75a48.22 48.22 0 0 1 4.272-8.25M12 2.25c-2.376 0-4.558.67-6.428 1.826M12 2.25c2.376 0 4.558.67 6.428 1.826"
    />
  );
}
