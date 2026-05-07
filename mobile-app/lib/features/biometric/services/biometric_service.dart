import 'package:biometric_signature/biometric_signature.dart'
    hide BiometricType;
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:local_auth/local_auth.dart';

import '../../../core/config/app_config.dart';
import '../../../core/utils/logger.dart';

/// Biometric authentication service.
///
/// Manages hardware-backed biometric key creation, signing, and verification
/// using the device's Secure Enclave (iOS) or StrongBox (Android).
///
/// The private key never leaves the secure hardware. Only the public key
/// and signatures are transmitted to the backend.
///
/// All handler names and return value shapes match the contract documented in
/// `MOBILE_FRONTEND_INTEGRATION.md`.
class BiometricService {
  static final BiometricSignature _biometric = BiometricSignature();
  static final LocalAuthentication _localAuth = LocalAuthentication();
  static final FlutterSecureStorage _storage = FlutterSecureStorage();

  /// Fallback alias when no user context is available (legacy / first install).
  static const String _defaultKeyAlias =
      '${AppConfig.biometricKeyAliasPrefix}default';

  /// In-memory cache for the active user ID.
  /// Populated lazily from [AppConfig.userIdStorageKey] on first use.
  String? _cachedUserId;

  // ===========================================================================
  // User Context
  // ===========================================================================

  /// Sets the active user for all subsequent biometric operations.
  ///
  /// Call this after every successful login (password or biometric) so that
  /// key creation and storage are scoped to the correct user. Persists the
  /// value across app restarts via [AppConfig.userIdStorageKey].
  Future<void> setCurrentUser(String userId) async {
    _cachedUserId = userId;
    await _storage.write(key: AppConfig.userIdStorageKey, value: userId);
    AppLogger.info('BiometricService: current user → $userId');
  }

  /// Returns the active user ID, loading it from storage on first call.
  Future<String?> _getCurrentUserId() async {
    _cachedUserId ??= await _storage.read(key: AppConfig.userIdStorageKey);
    return _cachedUserId;
  }

  // ===========================================================================
  // Per-User Key Derivation
  // ===========================================================================

  String _aliasForUser(String userId) =>
      '${AppConfig.biometricKeyAliasPrefix}$userId';

  String _credentialIdKey(String userId) =>
      '${AppConfig.credentialIdStorageKey}_$userId';

  String _publicKeyKey(String userId) =>
      '${AppConfig.publicKeyStorageKey}_$userId';

  /// Resolves the alias to use when CREATING a new key pair.
  ///
  /// Priority: explicit caller alias → user-derived alias → legacy default.
  /// Does NOT check stored alias — creation always targets the current user.
  Future<String> _resolveAliasForCreate(String? explicit) async {
    if (explicit != null) return explicit;
    final userId = await _getCurrentUserId();
    if (userId != null) return _aliasForUser(userId);
    return _defaultKeyAlias;
  }

  /// Resolves the alias to use when LOOKING UP an existing key.
  ///
  /// Priority: explicit caller alias → stored alias (user-namespaced) →
  ///           stored alias (legacy) → user-derived alias → legacy default.
  Future<String> _resolveAliasForLookup(String? explicit) async {
    if (explicit != null) return explicit;
    final stored = await _getStoredKeyAlias();
    if (stored != null) return stored;
    final userId = await _getCurrentUserId();
    if (userId != null) return _aliasForUser(userId);
    return _defaultKeyAlias;
  }

  // ===========================================================================
  // Availability
  // ===========================================================================

  /// Checks whether biometric authentication is available on this device.
  ///Uses local_auth plugin for checking availability (more reliable)
  /// and biometric_signature for cryptographic operations.
  ///
  /// Returns:
  /// ```json
  /// { "success": true, "canAuthenticate": true, "hasEnrolledBiometrics": true,
  ///   "availableBiometrics": ["fingerprint"], "reason": null }
  /// ```
  Future<Map<String, dynamic>> checkAvailability() async {
    AppLogger.info('🔍 BiometricService: Checking biometric availability...');

    try {
      // Use local_auth for availability check (handles Activity context better)
      final canCheckBiometrics = await _localAuth.canCheckBiometrics;
      final isDeviceSupported = await _localAuth.isDeviceSupported();

      AppLogger.info(
        '📱 local_auth results: canCheck=$canCheckBiometrics, supported=$isDeviceSupported',
      );

      if (!canCheckBiometrics || !isDeviceSupported) {
        final response = {
          'success': true,
          'canAuthenticate': false,
          'hasEnrolledBiometrics': false,
          'availableBiometrics': <String>[],
          'reason': 'Device does not support biometric authentication',
        };
        AppLogger.info('✅ BiometricService: Returning response: $response');
        return response;
      }

      // Get available biometric types
      final availableBiometrics = await _localAuth.getAvailableBiometrics();
      AppLogger.info('📱 Available biometrics: $availableBiometrics');

      final biometricTypes = availableBiometrics.map((type) {
        switch (type) {
          case BiometricType.face:
            return 'face';
          case BiometricType.fingerprint:
            return 'fingerprint';
          case BiometricType.iris:
            return 'iris';
          case BiometricType.strong:
            return 'strong';
          case BiometricType.weak:
            return 'weak';
        }
      }).toList();

      final hasEnrolled = availableBiometrics.isNotEmpty;

      final response = {
        'success': true,
        'canAuthenticate': hasEnrolled,
        'hasEnrolledBiometrics': hasEnrolled,
        'availableBiometrics': biometricTypes,
        'reason': hasEnrolled ? null : 'No biometrics enrolled on this device',
      };

      AppLogger.info('✅ BiometricService: Returning response: $response');
      return response;
    } on PlatformException catch (e) {
      AppLogger.error(
        '❌ BiometricService: Failed to check biometric availability',
        e,
      );
      return {
        'success': false,
        'canAuthenticate': false,
        'hasEnrolledBiometrics': false,
        'availableBiometrics': <String>[],
        'reason': e.message ?? 'Failed to check biometric availability',
      };
    } catch (e) {
      AppLogger.error(
        '❌ BiometricService: Unexpected error checking availability',
        e,
      );
      return {
        'success': false,
        'canAuthenticate': false,
        'hasEnrolledBiometrics': false,
        'availableBiometrics': <String>[],
        'reason': 'Unexpected error: $e',
      };
    }
  }

  // ===========================================================================
  // Key Creation
  // ===========================================================================

  /// Creates a new biometric-backed key pair on the device.
  ///
  /// [keyAlias] - Optional alias. When null, the current user's alias
  ///              (`biometrics_auth_{userId}`) is used, falling back to
  ///              [_defaultKeyAlias] if no user context is set.
  /// [promptMessage] - Prompt shown during biometric authentication.
  ///
  /// IMPORTANT: This method first authenticates the user with biometric to
  /// ensure they can actually use the feature before creating keys.
  ///
  /// Returns:
  /// ```json
  /// { "success": true, "publicKey": "MFkwEwYHKo...", "keyAlias": "biometrics_auth_{userId}" }
  /// ```
  Future<Map<String, dynamic>> createKeyPair({
    String? keyAlias,
    String? promptMessage,
  }) async {
    final effectiveAlias = await _resolveAliasForCreate(keyAlias);

    try {
      // STEP 1: Authenticate user BEFORE creating keys to verify they can use biometric
      AppLogger.info('🔐 Authenticating user before creating keys...');
      final authenticated = await _localAuth.authenticate(
        localizedReason:
            promptMessage ?? 'Authenticate to enable biometric login',
        options: const AuthenticationOptions(
          biometricOnly: true,
          stickyAuth: true,
        ),
      );

      if (!authenticated) {
        AppLogger.warning('❌ User failed biometric authentication');
        return {
          'success': false,
          'error': 'Biometric authentication failed or was cancelled',
        };
      }

      AppLogger.info('✅ User authenticated successfully, creating keys...');

      // STEP 2: Create the key pair (no prompt needed, already authenticated)
      AppLogger.info('Creating biometric key pair (alias: $effectiveAlias)');

      final result = await _biometric.createKeys(
        keyAlias: effectiveAlias,
        promptMessage: promptMessage ?? 'Authenticate to create signing keys',
      );

      if (result.error != null) {
        return {
          'success': false,
          'error': result.error,
          'code': result.code?.name,
        };
      }

      final publicKey = result.publicKey ?? '';
      if (publicKey.isEmpty) {
        return {
          'success': false,
          'error': 'Public key was not returned from secure hardware',
        };
      }

      // Persist alias and public key scoped to the current user.
      await _storeKeyAlias(effectiveAlias);
      await _storePublicKey(publicKey);

      AppLogger.info('Biometric key pair created successfully');
      return {
        'success': true,
        'publicKey': publicKey,
        'keyAlias': effectiveAlias,
      };
    } on PlatformException catch (e) {
      AppLogger.error('Failed to create biometric key pair', e);
      return {
        'success': false,
        'error': e.message ?? 'Failed to create biometric keys',
      };
    }
  }

  // ===========================================================================
  // Signing
  // ===========================================================================

  /// Signs a payload using the biometric-backed private key.
  ///
  /// [payload] - The challenge nonce from the server.
  /// [keyAlias] - Optional key alias. Falls back to the stored alias for the
  ///              current user, then the user-derived alias, then the default.
  /// [promptMessage] - Prompt shown during biometric authentication.
  ///
  /// Returns:
  /// ```json
  /// { "success": true, "authenticated": true, "signature": "MEUCI...",
  ///   "publicKey": "MFkwEw...", "payload": "challenge-nonce",
  ///   "keyAlias": "biometrics_auth_{userId}", "ts": "2026-05-07T..." }
  /// ```
  Future<Map<String, dynamic>> signPayload({
    required String payload,
    String? keyAlias,
    String? promptMessage,
  }) async {
    try {
      final effectiveAlias = await _resolveAliasForLookup(keyAlias);

      AppLogger.info(
        'Signing payload with biometric key (alias: $effectiveAlias)',
      );

      final result = await _biometric.createSignature(
        payload: payload,
        keyAlias: effectiveAlias,
        promptMessage: promptMessage ?? 'Authenticate to sign',
      );

      if (result.error != null) {
        return {
          'success': false,
          'authenticated': false,
          'error': result.error,
          'code': result.code?.name,
        };
      }

      final signature = result.signature ?? '';
      if (signature.isEmpty) {
        return {
          'success': false,
          'authenticated': false,
          'error': 'Signature was not returned from secure hardware',
        };
      }

      final publicKey = await _readPublicKey();

      AppLogger.info('Payload signed successfully');

      return {
        'success': true,
        'authenticated': true,
        'signature': signature,
        'publicKey': publicKey ?? '',
        'payload': payload,
        'keyAlias': effectiveAlias,
        'ts': DateTime.now().toUtc().toIso8601String(),
      };
    } on PlatformException catch (e) {
      AppLogger.error('Failed to sign payload', e);
      return {
        'success': false,
        'authenticated': false,
        'error': e.message ?? 'Biometric authentication failed',
      };
    }
  }

  // ===========================================================================
  // Key Management
  // ===========================================================================

  /// Checks whether a biometric key exists for the given alias.
  ///
  /// Returns: `{ "exists": true, "keyAlias": "...", "valid": true }`
  Future<Map<String, dynamic>> keyExists({String? keyAlias}) async {
    try {
      final effectiveAlias = await _resolveAliasForLookup(keyAlias);

      final info = await _biometric.getKeyInfo(
        keyAlias: effectiveAlias,
        checkValidity: true,
      );

      return {
        'exists': info.exists ?? false,
        'keyAlias': effectiveAlias,
        'valid': info.isValid ?? false,
      };
    } on PlatformException catch (e) {
      AppLogger.warning('Key exists check failed: ${e.message}');
      return {'exists': false, 'keyAlias': keyAlias, 'valid': false};
    }
  }

  /// Gets detailed information about a biometric key.
  ///
  /// Returns: `{ "exists", "keyAlias", "valid", "publicKey", "algorithm", "keySize" }`
  Future<Map<String, dynamic>> getKeyInfo({String? keyAlias}) async {
    try {
      final effectiveAlias = await _resolveAliasForLookup(keyAlias);

      final info = await _biometric.getKeyInfo(
        keyAlias: effectiveAlias,
        checkValidity: true,
      );

      return {
        'exists': info.exists ?? false,
        'keyAlias': effectiveAlias,
        'valid': info.isValid ?? false,
        'publicKey': info.publicKey,
        'algorithm': info.algorithm,
        'keySize': info.keySize,
      };
    } on PlatformException catch (e) {
      AppLogger.warning('Get key info failed: ${e.message}');
      return {'exists': false, 'keyAlias': keyAlias, 'valid': false};
    }
  }

  /// Deletes keys for a specific alias (defaults to the stored alias).
  Future<void> deleteKeys({String? keyAlias}) async {
    try {
      final effectiveAlias = await _resolveAliasForLookup(keyAlias);
      await _biometric.deleteKeys(keyAlias: effectiveAlias);
      AppLogger.info('Biometric keys deleted (alias: $effectiveAlias)');
    } catch (e) {
      AppLogger.warning('Failed to delete keys: $e');
    } finally {
      // Always clear local storage even if the hardware delete failed.
      await _clearKeyStorage();
    }
  }

  /// Deletes all biometric keys on the device.
  Future<void> deleteAllKeys() async {
    try {
      await _biometric.deleteAllKeys();
      AppLogger.info('All biometric keys deleted');
    } catch (e) {
      AppLogger.warning('Failed to delete all keys: $e');
    } finally {
      await _clearKeyStorage();
    }
  }

  // ===========================================================================
  // Simple Prompt
  // ===========================================================================

  /// Performs a simple biometric prompt without cryptographic operations.
  Future<Map<String, dynamic>> simplePrompt({required String message}) async {
    try {
      final result = await _biometric.simplePrompt(promptMessage: message);
      final isSuccess = result.success ?? false;
      return {
        'success': isSuccess,
        'authenticated': isSuccess,
        if (result.error != null) 'error': result.error,
        if (result.code != null) 'code': result.code?.name,
      };
    } on PlatformException catch (e) {
      return {
        'success': false,
        'authenticated': false,
        'error': e.message ?? 'Authentication failed',
      };
    }
  }

  // ===========================================================================
  // Secure Storage Helpers
  // ===========================================================================

  /// Stores the key alias scoped to the current user.
  /// Falls back to the non-namespaced key when no user context is set.
  Future<void> _storeKeyAlias(String keyAlias) async {
    final userId = await _getCurrentUserId();
    final storageKey = userId != null
        ? _credentialIdKey(userId)
        : AppConfig.credentialIdStorageKey;
    await _storage.write(key: storageKey, value: keyAlias);
  }

  /// Stores the public key scoped to the current user.
  /// Falls back to the non-namespaced key when no user context is set.
  Future<void> _storePublicKey(String publicKey) async {
    final userId = await _getCurrentUserId();
    final storageKey = userId != null
        ? _publicKeyKey(userId)
        : AppConfig.publicKeyStorageKey;
    await _storage.write(key: storageKey, value: publicKey);
  }

  /// Reads the stored key alias for the current user.
  ///
  /// Checks the user-namespaced key first, then falls back to the legacy
  /// non-namespaced key so existing enrollments continue to work after upgrade.
  Future<String?> _getStoredKeyAlias() async {
    final userId = await _getCurrentUserId();
    if (userId != null) {
      final namespaced = await _storage.read(key: _credentialIdKey(userId));
      if (namespaced != null) return namespaced;
    }
    // Legacy fallback for users enrolled before per-user namespacing.
    return _storage.read(key: AppConfig.credentialIdStorageKey);
  }

  /// Reads the stored public key for the current user.
  ///
  /// Checks the user-namespaced key first, then falls back to the legacy key.
  Future<String?> _readPublicKey() async {
    final userId = await _getCurrentUserId();
    if (userId != null) {
      final namespaced = await _storage.read(key: _publicKeyKey(userId));
      if (namespaced != null) return namespaced;
    }
    return _storage.read(key: AppConfig.publicKeyStorageKey);
  }

  /// Clears key-related storage entries for the current user.
  /// Also clears legacy (non-namespaced) keys to clean up old data.
  Future<void> _clearKeyStorage() async {
    final userId = await _getCurrentUserId();
    if (userId != null) {
      await _storage.delete(key: _credentialIdKey(userId));
      await _storage.delete(key: _publicKeyKey(userId));
    }
    // Always clear legacy keys to avoid stale entries.
    await _storage.delete(key: AppConfig.credentialIdStorageKey);
    await _storage.delete(key: AppConfig.publicKeyStorageKey);
  }
}
