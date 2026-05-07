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

  /// The key alias used when the caller passes null.
  /// Must be stable across app sessions so signing can find the key.
  static const String _defaultKeyAlias =
      '${AppConfig.biometricKeyAliasPrefix}default';

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
  /// [keyAlias] - Optional alias. When null, [_defaultKeyAlias] is used so
  ///              the same key can be found later during signing.
  /// [promptMessage] - Prompt shown during biometric authentication.
  ///
  /// Returns:
  /// ```json
  /// { "success": true, "publicKey": "MFkwEwYHKo...", "keyAlias": "biometrics_auth_default" }
  /// ```
  Future<Map<String, dynamic>> createKeyPair({
    String? keyAlias,
    String? promptMessage,
  }) async {
    // Always resolve to a non-null alias so the key can be retrieved for signing.
    final effectiveAlias = keyAlias ?? _defaultKeyAlias;

    try {
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

      // Persist the alias and public key so they survive app restarts.
      await _storeKeyAlias(effectiveAlias);
      await _storage.write(
        key: AppConfig.publicKeyStorageKey,
        value: publicKey,
      );

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
  /// [keyAlias] - Optional key alias. Falls back to the stored alias, then
  ///              to [_defaultKeyAlias].
  /// [promptMessage] - Prompt shown during biometric authentication.
  ///
  /// Returns:
  /// ```json
  /// { "success": true, "authenticated": true, "signature": "MEUCI...",
  ///   "publicKey": "MFkwEw...", "payload": "challenge-nonce",
  ///   "keyAlias": "biometrics_auth_default", "ts": "2026-05-07T..." }
  /// ```
  Future<Map<String, dynamic>> signPayload({
    required String payload,
    String? keyAlias,
    String? promptMessage,
  }) async {
    try {
      // Resolve: explicit alias → stored alias → hard-coded default.
      final effectiveAlias =
          keyAlias ?? await _getStoredKeyAlias() ?? _defaultKeyAlias;

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

      final publicKey = await _storage.read(key: AppConfig.publicKeyStorageKey);

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
      final effectiveAlias =
          keyAlias ?? await _getStoredKeyAlias() ?? _defaultKeyAlias;

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
      final effectiveAlias =
          keyAlias ?? await _getStoredKeyAlias() ?? _defaultKeyAlias;

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
      final effectiveAlias =
          keyAlias ?? await _getStoredKeyAlias() ?? _defaultKeyAlias;
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

  /// Stores the key alias in secure storage.
  Future<void> _storeKeyAlias(String keyAlias) async {
    await _storage.write(
      key: AppConfig.credentialIdStorageKey,
      value: keyAlias,
    );
  }

  /// Retrieves the stored key alias (returns null if never set).
  Future<String?> _getStoredKeyAlias() async {
    return _storage.read(key: AppConfig.credentialIdStorageKey);
  }

  /// Clears key-related storage entries.
  Future<void> _clearKeyStorage() async {
    await _storage.delete(key: AppConfig.credentialIdStorageKey);
    await _storage.delete(key: AppConfig.publicKeyStorageKey);
  }
}
