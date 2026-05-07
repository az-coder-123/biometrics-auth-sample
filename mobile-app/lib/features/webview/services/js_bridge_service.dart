import 'dart:convert';

import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import '../../../core/utils/logger.dart';
import '../../biometric/services/biometric_service.dart';

/// JavaScript bridge service for WebView-to-native communication.
///
/// Registers JavaScript handler names on the InAppWebView controller
/// that the web application can call via `window.flutter_inappwebview.callHandler()`.
///
/// Handler names follow the flat naming convention documented in
/// BIOMETRIC_WEB_INTEGRATION_GUIDE.md:
/// - `biometricAuthAvailable` — Check device support
/// - `biometricCreateKeys` — Create key pair
/// - `biometricSign` — Sign challenge
/// - `biometricKeyExists` — Check if keys exist
/// - `biometricGetKeyInfo` — Get key details
/// - `biometricDeleteKeys` — Delete keys by alias
/// - `biometricDeleteAllKeys` — Delete all keys
/// - `biometricSimplePrompt` — Quick prompt without crypto
/// - `LogBridge.info/warn/error/debug` — Log forwarding
class JsBridgeService {
  final BiometricService _biometricService;

  /// Creates a new JsBridgeService.
  ///
  /// [biometricService] - The biometric service instance to delegate
  /// biometric operations to.
  JsBridgeService({required BiometricService biometricService})
    : _biometricService = biometricService;

  // ===========================================================================
  // Handler Registration
  // ===========================================================================

  /// Registers all JavaScript bridge handlers on the WebView controller.
  ///
  /// Call this once when the WebView is created, before any page loads.
  void registerHandlers(InAppWebViewController controller) {
    AppLogger.info('🔧 Registering JavaScript bridge handlers...');
    _registerBiometricHandlers(controller);
    _registerLogHandlers(controller);
    AppLogger.info('✅ All JS bridge handlers registered successfully');
  }

  // ===========================================================================
  // Biometric Handlers
  // ===========================================================================

  /// Registers biometric-related JavaScript bridge handlers.
  ///
  /// Handler names and argument signatures match the integration guide
  /// so the frontend can call them directly:
  /// ```javascript
  /// window.flutter_inappwebview.callHandler('biometricAuthAvailable')
  /// window.flutter_inappwebview.callHandler('biometricCreateKeys', keyAlias?, reason?)
  /// window.flutter_inappwebview.callHandler('biometricSign', payload, keyAlias?, reason?)
  /// window.flutter_inappwebview.callHandler('biometricKeyExists', keyAlias?)
  /// window.flutter_inappwebview.callHandler('biometricDeleteKeys', keyAlias?)
  /// window.flutter_inappwebview.callHandler('biometricDeleteAllKeys')
  /// window.flutter_inappwebview.callHandler('biometricSimplePrompt', message, reason?)
  /// ```
  void _registerBiometricHandlers(InAppWebViewController controller) {
    // -----------------------------------------------------------------------
    // biometricAuthAvailable
    // Returns: { canAuthenticate, hasEnrolledBiometrics, availableBiometrics, reason }
    // -----------------------------------------------------------------------
    controller.addJavaScriptHandler(
      handlerName: 'biometricAuthAvailable',
      callback: (args) async {
        AppLogger.info('🔔 JS Bridge: biometricAuthAvailable called');
        final result = await _biometricService.checkAvailability();
        AppLogger.info('✅ JS Bridge: biometricAuthAvailable result: $result');
        return result;
      },
    );

    // -----------------------------------------------------------------------
    // biometricCreateKeys(keyAlias?, reason?)
    // Returns: { success, publicKey, keyAlias } or { success: false, error, code }
    // -----------------------------------------------------------------------
    controller.addJavaScriptHandler(
      handlerName: 'biometricCreateKeys',
      callback: (args) async {
        AppLogger.debug('JS Bridge: biometricCreateKeys($args)');
        final keyAlias = _positionalArg(args, 0) as String?;
        final reason = _positionalArg(args, 1) as String?;
        return await _biometricService.createKeyPair(
          keyAlias: keyAlias,
          promptMessage: reason ?? 'Authenticate to create signing keys',
        );
      },
    );

    // -----------------------------------------------------------------------
    // biometricSign(payload, keyAlias?, reason?)
    // Returns: { success, signature, publicKey, payload, keyAlias, ts }
    // -----------------------------------------------------------------------
    controller.addJavaScriptHandler(
      handlerName: 'biometricSign',
      callback: (args) async {
        AppLogger.debug('JS Bridge: biometricSign($args)');
        final payload = _positionalArg(args, 0) as String?;
        final keyAlias = _positionalArg(args, 1) as String?;
        final reason = _positionalArg(args, 2) as String?;

        if (payload == null || payload.isEmpty) {
          return {
            'success': false,
            'authenticated': false,
            'error': 'Payload is required',
          };
        }

        return await _biometricService.signPayload(
          payload: payload,
          keyAlias: keyAlias,
          promptMessage: reason ?? 'Authenticate to sign',
        );
      },
    );

    // -----------------------------------------------------------------------
    // biometricKeyExists(keyAlias?)
    // Returns: { exists, keyAlias, valid }
    // -----------------------------------------------------------------------
    controller.addJavaScriptHandler(
      handlerName: 'biometricKeyExists',
      callback: (args) async {
        AppLogger.debug('JS Bridge: biometricKeyExists($args)');
        final keyAlias = _positionalArg(args, 0) as String?;
        return await _biometricService.keyExists(keyAlias: keyAlias);
      },
    );

    // -----------------------------------------------------------------------
    // biometricGetKeyInfo(keyAlias?)
    // Returns: { exists, keyAlias, valid, publicKey }
    // -----------------------------------------------------------------------
    controller.addJavaScriptHandler(
      handlerName: 'biometricGetKeyInfo',
      callback: (args) async {
        AppLogger.debug('JS Bridge: biometricGetKeyInfo($args)');
        final keyAlias = _positionalArg(args, 0) as String?;
        return await _biometricService.getKeyInfo(keyAlias: keyAlias);
      },
    );

    // -----------------------------------------------------------------------
    // biometricDeleteKeys(keyAlias?)
    // Returns: { success }
    // -----------------------------------------------------------------------
    controller.addJavaScriptHandler(
      handlerName: 'biometricDeleteKeys',
      callback: (args) async {
        AppLogger.debug('JS Bridge: biometricDeleteKeys($args)');
        final keyAlias = _positionalArg(args, 0) as String?;
        await _biometricService.deleteKeys(keyAlias: keyAlias);
        return {'success': true};
      },
    );

    // -----------------------------------------------------------------------
    // biometricDeleteAllKeys
    // Returns: { success }
    // -----------------------------------------------------------------------
    controller.addJavaScriptHandler(
      handlerName: 'biometricDeleteAllKeys',
      callback: (args) async {
        AppLogger.debug('JS Bridge: biometricDeleteAllKeys');
        await _biometricService.deleteAllKeys();
        return {'success': true};
      },
    );

    // -----------------------------------------------------------------------
    // biometricSimplePrompt(message, reason?)
    // Returns: { success, authenticated }
    // -----------------------------------------------------------------------
    controller.addJavaScriptHandler(
      handlerName: 'biometricSimplePrompt',
      callback: (args) async {
        AppLogger.debug('JS Bridge: biometricSimplePrompt($args)');
        final message =
            _positionalArg(args, 0) as String? ?? 'Verify your identity';
        return await _biometricService.simplePrompt(message: message);
      },
    );

    // -----------------------------------------------------------------------
    // setCurrentUser(userId)
    // Scopes all subsequent biometric operations to this user's keys.
    // Call after every successful login (password or biometric).
    // Returns: { success }
    // -----------------------------------------------------------------------
    controller.addJavaScriptHandler(
      handlerName: 'setCurrentUser',
      callback: (args) async {
        AppLogger.debug('JS Bridge: setCurrentUser($args)');
        final userId = _positionalArg(args, 0) as String?;
        if (userId != null && userId.isNotEmpty) {
          await _biometricService.setCurrentUser(userId);
        }
        return {'success': true};
      },
    );
  }

  // ===========================================================================
  // Log Bridge Handlers
  // ===========================================================================

  /// Registers log forwarding JavaScript bridge handlers.
  void _registerLogHandlers(InAppWebViewController controller) {
    controller.addJavaScriptHandler(
      handlerName: 'LogBridge.info',
      callback: (args) {
        final message = _extractArg(args, 'message') as String? ?? '';
        AppLogger.info('[WebView] $message');
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'LogBridge.warn',
      callback: (args) {
        final message = _extractArg(args, 'message') as String? ?? '';
        AppLogger.warning('[WebView] $message');
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'LogBridge.error',
      callback: (args) {
        final message = _extractArg(args, 'message') as String? ?? '';
        AppLogger.error('[WebView] $message');
      },
    );

    controller.addJavaScriptHandler(
      handlerName: 'LogBridge.debug',
      callback: (args) {
        final message = _extractArg(args, 'message') as String? ?? '';
        AppLogger.debug('[WebView] $message');
      },
    );
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /// Extracts a positional argument from the JS bridge callback arguments.
  ///
  /// InAppWebView passes JavaScript callHandler arguments as a List of dynamic values.
  /// For example, `callHandler('biometricSign', payload, alias)` produces
  /// args = [payload_value, alias_value].
  dynamic _positionalArg(List<dynamic> args, int index) {
    if (index >= args.length) return null;
    return args[index];
  }

  /// Extracts a named argument from the JS bridge callback arguments.
  ///
  /// Used when the caller passes a JavaScript object:
  /// `callHandler('handler', {key: value})` produces args = `[key: value]`.
  dynamic _extractArg(List<dynamic> args, String key) {
    if (args.isEmpty) return null;
    final arg = args.first;
    if (arg is Map) return arg[key];
    if (arg is String) {
      try {
        final parsed = jsonDecode(arg);
        if (parsed is Map) return parsed[key];
      } catch (_) {
        // Not JSON, ignore
      }
    }
    return null;
  }
}
