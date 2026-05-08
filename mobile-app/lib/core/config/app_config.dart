import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Application configuration constants.
///
/// Centralizes all configurable values used throughout the app.
/// Environment-specific values are loaded from the `.env` file via
/// `flutter_dotenv`. See `.env.example` for available variables.
class AppConfig {
  // ---------------------------------------------------------------------------
  // WebView
  // ---------------------------------------------------------------------------

  /// Base URL for the web application loaded in the WebView.
  static String get webAppUrl =>
      dotenv.env['WEB_APP_URL'] ?? 'http://localhost:3001';

  /// Initial route path for the WebView.
  static const String initialRoute = '/login';

  /// User agent suffix appended to the default WebView user agent.
  static const String userAgentSuffix = 'BiometricsAuthSample/1.0';

  // ---------------------------------------------------------------------------
  // Biometric
  // ---------------------------------------------------------------------------

  /// Key alias prefix for biometric key storage.
  static const String biometricKeyAliasPrefix = 'biometrics_auth_';

  /// Secure storage key for the biometric credential ID.
  static const String credentialIdStorageKey = 'biometric_credential_id';

  /// Secure storage key for the biometric public key.
  static const String publicKeyStorageKey = 'biometric_public_key';

  /// Secure storage key for the JWT access token.
  static const String accessTokenStorageKey = 'auth_access_token';

  /// Secure storage key for the user ID.
  static const String userIdStorageKey = 'auth_user_id';

  /// Secure storage key for the user email.
  static const String userEmailStorageKey = 'auth_user_email';

  // ---------------------------------------------------------------------------
  // JavaScript Bridge
  // ---------------------------------------------------------------------------

  /// JavaScript handler name for the biometric bridge.
  static const String biometricBridgeName = 'BiometricBridge';

  /// JavaScript handler name for the log bridge.
  static const String logBridgeName = 'LogBridge';
}
