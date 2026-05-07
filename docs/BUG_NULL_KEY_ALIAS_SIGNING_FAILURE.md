# Bug Report: Silent Signing Failure Due to Unresolved Null Key Alias

| Field       | Value                                              |
|-------------|-----------------------------------------------------|
| **ID**      | BUG-001                                             |
| **Component** | `mobile-app` — `BiometricService`               |
| **File**    | `lib/features/biometric/services/biometric_service.dart` |
| **Severity** | Critical — biometric login completely non-functional |
| **Status**  | Fixed                                               |
| **Packages** | `biometric_signature ^11.1.0`, `flutter_secure_storage ^9.2.4` |

---

## Summary

When the JavaScript bridge calls `biometricCreateKeys` or `biometricSign` with
`keyAlias = null` (the documented default for both handlers), the key creation
succeeds but the resulting alias is never persisted. Any subsequent signing
attempt finds no alias in secure storage and returns a hard error without ever
reaching the secure hardware. The user's biometric is never prompted and login
is silently impossible.

---

## Background

The `biometric_signature` Flutter plugin requires the caller to supply an
explicit `keyAlias` string when calling `createSignature`. The alias is how the
plugin locates the correct key in the Android Keystore / iOS Secure Enclave.

`BiometricService` was designed to accept an optional `keyAlias` parameter and
fall back to a value retrieved from `FlutterSecureStorage`. The intended flow
was:

1. **Create** — generate a key pair, persist the alias.
2. **Sign** — look up the persisted alias, use it to sign.

This flow breaks silently when `keyAlias` is `null`.

---

## Root Cause

### `_storeKeyAlias` silently skips `null`

The helper function that persists the alias had an early-return guard for
`null`:

```dart
// BEFORE (buggy)
Future<void> _storeKeyAlias(String? keyAlias) async {
  if (keyAlias != null) {          // ← nothing stored when keyAlias is null
    await _storage.write(
      key: AppConfig.credentialIdStorageKey,
      value: keyAlias,
    );
  }
}
```

### `createKeyPair` forwards `null` unchanged

```dart
// BEFORE (buggy)
Future<Map<String, dynamic>> createKeyPair({
  String? keyAlias,
  String? promptMessage,
}) async {
  final result = await _biometric.createKeys(keyAlias: keyAlias, ...);
  // ...
  await _storeKeyAlias(keyAlias);  // ← called with null → stores nothing
  // ...
  return {'success': true, 'publicKey': publicKey, 'keyAlias': keyAlias};
                                   // ← returned keyAlias is also null
}
```

The `biometric_signature` plugin accepts a `null` alias and uses its own
internal default. That internal default is an implementation detail of the
plugin and is **not returned** in the result — there is no way to recover it
after the call returns.

### `signPayload` fails when alias is absent

```dart
// BEFORE (buggy)
Future<Map<String, dynamic>> signPayload({
  required String payload,
  String? keyAlias,
  String? promptMessage,
}) async {
  keyAlias ??= await _getStoredKeyAlias();   // returns null (nothing stored)

  if (keyAlias == null) {                    // ← always true after create
    return {
      'success': false,
      'authenticated': false,
      'error': 'Key not found',              // ← silent failure, no prompt
      'code': 'keyNotFound',
    };
  }
  // ...
}
```

---

## Failure Sequence

```
Frontend                  JsBridgeService          BiometricService         Secure Storage
─────────────────────     ───────────────────────  ──────────────────────── ──────────────
createKeys(null, reason)
  ──────────────────────► biometricCreateKeys
                          args[0] = null
                            ──────────────────────► createKeyPair(null)
                                                     createKeys(keyAlias: null)
                                                     ✓ key created in hardware
                                                     _storeKeyAlias(null)
                                                       if (null != null) → skip ────► (nothing written)
                                                     return { success: true,
                                                              publicKey: "...",
                                                              keyAlias: null }
  ◄─────────────────────────────────────────────── { success: true, keyAlias: null }

[user logs out, app restarts]

sign(challenge, null, reason)
  ──────────────────────► biometricSign
                          args[1] = null
                            ──────────────────────► signPayload(null)
                                                     keyAlias ??= _getStoredKeyAlias()
                                                                    ◄──────────────── null (nothing stored)
                                                     keyAlias == null → true
                                                     return { success: false,
                                                              error: "Key not found" }
  ◄─────────────────────────────────────────────── { success: false, error: "Key not found" }

[BiometricBridge.sign resolves to { success: false }]
[loginWithBiometric returns { success: false, error: "Login failed..." }]
[User sees login failure — biometric prompt NEVER shown]
```

---

## Impact

| Affected Flow           | Symptom                                                              |
|-------------------------|----------------------------------------------------------------------|
| Native biometric login  | Always fails after the first app session. Biometric prompt is never shown. |
| Native biometric enroll | Reports success. Subsequent login attempts silently fail.            |
| Key deletion            | `keyAlias = null` also affected — stale keys may accumulate in the hardware keystore (pre-fix). |

Since the JavaScript bridge always passes `null` for `keyAlias` (matching the
documented API contract), **every user on every device was affected**. The bug
was not visible during the key-creation flow because `createKeyPair` returns
`{ success: true }`, masking the underlying storage omission.

---

## Fix

### Strategy

Introduce a stable, application-defined constant (`_defaultKeyAlias`) used
whenever the caller passes `null`. This alias is always passed to the plugin
and always persisted, so `signPayload` can reliably retrieve it.

```dart
// AFTER (fixed)
static const String _defaultKeyAlias =
    '${AppConfig.biometricKeyAliasPrefix}default';
// resolves to: 'biometrics_auth_default'
```

### `createKeyPair` — resolve alias before creating key

```dart
// AFTER (fixed)
Future<Map<String, dynamic>> createKeyPair({
  String? keyAlias,
  String? promptMessage,
}) async {
  // Always resolve to a non-null alias BEFORE calling the plugin.
  final effectiveAlias = keyAlias ?? _defaultKeyAlias;

  final result = await _biometric.createKeys(
    keyAlias: effectiveAlias,       // ← never null
    promptMessage: ...,
  );
  // ...
  await _storeKeyAlias(effectiveAlias);   // ← always stored
  // ...
  return {
    'success': true,
    'publicKey': publicKey,
    'keyAlias': effectiveAlias,     // ← non-null returned to caller
  };
}
```

### `_storeKeyAlias` — parameter made non-nullable

```dart
// AFTER (fixed)
Future<void> _storeKeyAlias(String keyAlias) async {  // ← String, not String?
  await _storage.write(
    key: AppConfig.credentialIdStorageKey,
    value: keyAlias,
  );
}
```

The Dart type system now prevents accidentally passing `null`, turning a
silent runtime failure into a compile-time error.

### `signPayload` — three-level alias resolution

```dart
// AFTER (fixed)
Future<Map<String, dynamic>> signPayload({
  required String payload,
  String? keyAlias,
  String? promptMessage,
}) async {
  // Resolve: explicit → stored → hard-coded default (should always find one).
  final effectiveAlias =
      keyAlias ?? await _getStoredKeyAlias() ?? _defaultKeyAlias;

  final result = await _biometric.createSignature(
    payload: payload,
    keyAlias: effectiveAlias,   // ← always non-null, plugin always finds key
    promptMessage: ...,
  );
  // ...
}
```

The `_defaultKeyAlias` fallback at the end is a last-resort safety net. In
normal operation the alias is read from secure storage; the constant is only
used if storage was cleared externally (e.g., app uninstall/reinstall).

### Fixed Sequence

```
Frontend                  JsBridgeService          BiometricService         Secure Storage
─────────────────────     ───────────────────────  ──────────────────────── ──────────────
createKeys(null, reason)
  ──────────────────────► biometricCreateKeys
                            ──────────────────────► createKeyPair(null)
                                                     effectiveAlias = 'biometrics_auth_default'
                                                     createKeys(keyAlias: 'biometrics_auth_default')
                                                     ✓ key created in hardware
                                                     _storeKeyAlias('biometrics_auth_default') ─► stored
                                                     return { success: true,
                                                              keyAlias: 'biometrics_auth_default' }
  ◄─────────────────────────────────────────────── { success: true }

sign(challenge, null, reason)
  ──────────────────────► biometricSign
                            ──────────────────────► signPayload(null)
                                                     effectiveAlias = _getStoredKeyAlias()
                                                                       ◄──────────────── 'biometrics_auth_default'
                                                     createSignature(keyAlias: 'biometrics_auth_default')
                                                     🖐️  Biometric prompt shown
                                                     ✓ signature returned
  ◄─────────────────────────────────────────────── { success: true, signature: "...", publicKey: "..." }

[loginWithBiometric succeeds, JWT issued]
```

---

## Additional Changes in the Same Commit

Two related fixes were bundled with this bug fix:

### 1. `availableBiometrics` null-entry filtering

The `checkAvailability` method mapped over a `List<BiometricType?>` without
filtering null elements, producing `null` strings in the returned JSON array.
The frontend's TypeScript type `availableBiometrics: string[]` does not accept
`null`, which caused incorrect biometric-type detection on certain Android
devices that report partial availability data.

```dart
// BEFORE
'availableBiometrics': result.availableBiometrics
    ?.map((e) => e?.name)     // ← may contain null
    .toList() ?? [],

// AFTER
'availableBiometrics': result.availableBiometrics
    ?.where((e) => e != null) // ← filter nulls first
    .map((e) => e!.name)
    .toList() ?? [],
```

### 2. `deleteKeys` / `deleteAllKeys` — storage cleared in `finally`

Previously, if the native `deleteKeys` call threw an exception the local
secure-storage entries (`credentialIdStorageKey`, `publicKeyStorageKey`) were
never cleared, leaving the app in an inconsistent state where storage held a
reference to a key that no longer existed.

```dart
// AFTER
Future<void> deleteKeys({String? keyAlias}) async {
  try {
    final effectiveAlias = keyAlias ?? await _getStoredKeyAlias() ?? _defaultKeyAlias;
    await _biometric.deleteKeys(keyAlias: effectiveAlias);
  } catch (e) {
    AppLogger.warning('Failed to delete keys: $e');
  } finally {
    await _clearKeyStorage();   // ← always runs
  }
}
```

---

## Testing Checklist

| Scenario | Expected Result |
|---|---|
| Enroll biometric (first install) | `createKeyPair` succeeds, alias `biometrics_auth_default` stored |
| Biometric login after enroll | Prompt shown, signature returned, JWT issued |
| Re-enroll after disable | Old key deleted, new key created with same alias |
| Sign after app reinstall | Alias resolved from `_defaultKeyAlias`, prompt shown |
| Sign after storage cleared externally | Alias falls back to `_defaultKeyAlias`, attempt proceeds |
| `deleteKeys` when native delete fails | Storage cleared regardless, app state consistent |

---

## References

- `mobile-app/lib/features/biometric/services/biometric_service.dart`
- `mobile-app/lib/core/config/app_config.dart` — `biometricKeyAliasPrefix`
- `docs/MOBILE_FRONTEND_INTEGRATION.md` — JS bridge handler contract
- `biometric_signature` package: `createKeys`, `createSignature` API
