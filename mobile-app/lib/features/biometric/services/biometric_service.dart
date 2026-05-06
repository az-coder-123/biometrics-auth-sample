import 'package:biometric_signature/biometric_signature.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

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
/// `BIOMETRIC_WEB_INTEGRATION_GUIDE.md`.
class BiometricService {
  static final BiometricSignature _biometric = BiometricSignature();
  static final FlutterSecureStorage _storage = FlutterSecureStorage();

  // ===========================================================================
  // Availability
  // ===========================================================================

  /// Checks whether biometric authentication is available on this device.
  ///
  /// Returns:
  /// ```json
  /// { "canAuthenticate": true, "hasEnrolledBiometrics": true,
  ///   "availableBiometrics": ["fingerprint"], "reason": null }
  /// ```
  Future<Map<String, dynamic>> checkAvailability() async {
    try {
      final result = await _biometric.biometricAuthAvailable();
      return {
        'success': true,
        'canAuthenticate': result.canAuthenticate ?? false,
        'hasEnrolledBiometrics': result.hasEnrolledBiometrics ?? false,
        'availableBiometrics':
            result.availableBiometrics?.map((e) => e?.name).toList() ?? [],
        'reason': result.reason,
      };
    } on PlatformException catch (e) {
      AppLogger.error('Failed to check biometric availability', e);
      return {
        'success': false,
        'canAuthenticate': false,
        'hasEnrolledBiometrics': false,
        'availableBiometrics': <String>[],
        'reason': e.message ?? 'Failed to check biometric availability',
      };
    }
  }

  // ===========================================================================
  // Key Creation
  // ===========================================================================

  /// Creates a new biometric-backed key pair on the device.
  ///
  /// [keyAlias] - Optional alias (null = default).
  /// [promptMessage] - Prompt shown during biometric authentication.
  ///
  /// Returns:
  /// ```json
  /// { "success": true, "publicKey": "MFkwEwYHKo...", "keyAlias": null }
  /// ```
  Future<Map<String, dynamic>> createKeyPair({
    String? keyAlias,
    String? promptMessage,
  }) async {
    try {
      AppLogger.info(
        'Creating biometric key pair (alias: ${keyAlias ?? "default"})',
      );

      final result = await _biometric.createKeys(
        keyAlias: keyAlias,
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

      // Store mapping for this key alias
      await _storeKeyAlias(keyAlias);
      await _storage.write(
        key: AppConfig.publicKeyStorageKey,
        value: publicKey,
      );

      AppLogger.info('Biometric key pair created successfully');
      return {'success': true, 'publicKey': publicKey, 'keyAlias': keyAlias};
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
  /// [keyAlias] - Optional key alias (null = default).
  /// [promptMessage] - Prompt shown during biometric authentication.
  ///
  /// Returns:
  /// ```json
  /// { "success": true, "authenticated": true, "signature": "MEUCI...",
  ///   "publicKey": "MFkwEw...", "payload": "challenge-nonce",
  ///   "keyAlias": null, "ts": "2026-05-04T08:30:00.000Z" }
  /// ```
  Future<Map<String, dynamic>> signPayload({
    required String payload,
    String? keyAlias,
    String? promptMessage,
  }) async {
    try {
      // Resolve key alias from storage if not provided
      keyAlias ??= await _getStoredKeyAlias();

      if (keyAlias == null) {
        return {
          'success': false,
          'authenticated': false,
          'error': 'Key not found',
          'code': 'keyNotFound',
        };
      }

      AppLogger.info('Signing payload with biometric key');

      final result = await _biometric.createSignature(
        payload: payload,
        keyAlias: keyAlias,
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
        'keyAlias': keyAlias,
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
      keyAlias ??= await _getStoredKeyAlias();
      if (keyAlias == null) {
        return {'exists': false, 'keyAlias': null, 'valid': false};
      }

      final info = await _biometric.getKeyInfo(
        keyAlias: keyAlias,
        checkValidity: true,
      );

      return {
        'exists': info.exists ?? false,
        'keyAlias': keyAlias,
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
      keyAlias ??= await _getStoredKeyAlias();
      if (keyAlias == null) {
        return {'exists': false, 'keyAlias': null, 'valid': false};
      }

      final info = await _biometric.getKeyInfo(
        keyAlias: keyAlias,
        checkValidity: true,
      );

      return {
        'exists': info.exists ?? false,
        'keyAlias': keyAlias,
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

  /// Deletes keys for a specific alias.
  Future<void> deleteKeys({String? keyAlias}) async {
    try {
      keyAlias ??= await _getStoredKeyAlias();
      if (keyAlias != null) {
        await _biometric.deleteKeys(keyAlias: keyAlias);
      }
      await _clearKeyStorage();
      AppLogger.info('Biometric keys deleted');
    } catch (e) {
      AppLogger.warning('Failed to delete keys: $e');
    }
  }

  /// Deletes all biometric keys on the device.
  Future<void> deleteAllKeys() async {
    try {
      await _biometric.deleteAllKeys();
      await _clearKeyStorage();
      AppLogger.info('All biometric keys deleted');
    } catch (e) {
      AppLogger.warning('Failed to delete all keys: $e');
    }
  }

  // ===========================================================================
  // Simple Prompt
  // ===========================================================================

  /// Performs a simple biometric prompt without cryptographic operations.
  ///
  /// Useful for a quick identity verification without needing keys.
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
  Future<void> _storeKeyAlias(String? keyAlias) async {
    if (keyAlias != null) {
      await _storage.write(
        key: AppConfig.credentialIdStorageKey,
        value: keyAlias,
      );
    }
  }

  /// Retrieves the stored key alias.
  Future<String?> _getStoredKeyAlias() async {
    return _storage.read(key: AppConfig.credentialIdStorageKey);
  }

  /// Clears key-related storage entries.
  Future<void> _clearKeyStorage() async {
    await _storage.delete(key: AppConfig.credentialIdStorageKey);
    await _storage.delete(key: AppConfig.publicKeyStorageKey);
  }
}
