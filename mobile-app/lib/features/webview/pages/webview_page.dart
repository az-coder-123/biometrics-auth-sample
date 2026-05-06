import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/config/app_config.dart';
import '../../../core/utils/logger.dart';
import '../../biometric/services/biometric_service.dart';
import '../services/js_bridge_service.dart';

/// Main WebView page that hosts the web application.
///
/// Loads the frontend web application in an InAppWebView and registers
/// JavaScript bridge handlers for biometric authentication, auth token
/// management, and log forwarding.
///
/// Architecture:
/// - WebView loads the Next.js frontend (http://localhost:3001)
/// - JS bridge enables the web app to call native biometric operations
/// - Log bridge forwards web console messages to native logger
class WebViewPage extends StatefulWidget {
  const WebViewPage({super.key});

  @override
  State<WebViewPage> createState() => _WebViewPageState();
}

class _WebViewPageState extends State<WebViewPage> {
  InAppWebViewController? _webViewController;
  late final JsBridgeService _jsBridgeService;
  double _loadingProgress = 0;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    // Initialize services
    final biometricService = BiometricService();
    _jsBridgeService = JsBridgeService(biometricService: biometricService);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        // Handle back button: navigate WebView back if possible
        if (_webViewController != null) {
          final canGoBack = await _webViewController!.canGoBack();
          if (canGoBack) {
            _webViewController!.goBack();
          }
        }
      },
      child: Scaffold(
        body: SafeArea(
          child: Stack(
            children: [
              // WebView
              InAppWebView(
                initialUrlRequest: URLRequest(
                  url: WebUri(
                    '${AppConfig.webAppUrl}${AppConfig.initialRoute}',
                  ),
                ),
                initialSettings: _buildWebViewSettings(),
                onWebViewCreated: _onWebViewCreated,
                onLoadStart: _onLoadStart,
                onLoadStop: _onLoadStop,
                onProgressChanged: _onProgressChanged,
                shouldOverrideUrlLoading: _shouldOverrideUrlLoadingAsync,
                onConsoleMessage: _onConsoleMessage,
              ),

              // Loading indicator
              if (_isLoading)
                LinearProgressIndicator(
                  value: _loadingProgress,
                  backgroundColor: Colors.grey[200],
                  valueColor: const AlwaysStoppedAnimation<Color>(
                    Colors.indigo,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  /// Configures the WebView settings.
  InAppWebViewSettings _buildWebViewSettings() {
    return InAppWebViewSettings(
      // Enable JavaScript
      javaScriptEnabled: true,
      // Allow debugging in development
      isInspectable: true,
      // Enable DOM storage for localStorage/sessionStorage
      domStorageEnabled: true,
      // Allow mixed content (HTTP + HTTPS) for development
      mixedContentMode: MixedContentMode.MIXED_CONTENT_ALWAYS_ALLOW,
      // Cache settings
      cacheEnabled: true,
      // Append to the existing user agent to identify mobile app
      applicationNameForUserAgent: AppConfig.userAgentSuffix,
      // Support horizontal scrolling gestures
      supportZoom: false,
      // Disable the built-in context menu
      disableContextMenu: true,
    );
  }

  /// Called when the WebView is created and the controller is available.
  void _onWebViewCreated(InAppWebViewController controller) {
    _webViewController = controller;

    // Register all JavaScript bridge handlers
    _jsBridgeService.registerHandlers(controller);

    AppLogger.info('WebView created and JS bridge handlers registered');
  }

  /// Called when a page starts loading.
  void _onLoadStart(InAppWebViewController controller, WebUri? url) {
    setState(() {
      _isLoading = true;
      _loadingProgress = 0;
    });
    AppLogger.info('WebView loading: ${url?.toString()}');
  }

  /// Called when a page finishes loading.
  void _onLoadStop(InAppWebViewController controller, WebUri? url) {
    setState(() {
      _isLoading = false;
    });
    AppLogger.info('WebView loaded: ${url?.toString()}');
  }

  /// Called when the loading progress changes.
  void _onProgressChanged(InAppWebViewController controller, int progress) {
    setState(() {
      _loadingProgress = progress / 100.0;
    });
  }

  /// Intercepts URL navigation to handle external links.
  ///
  /// Internal URLs (matching the web app URL) stay in the WebView.
  /// External URLs open in the system browser.
  /// Special schemes (tel:, mailto:, sms:) are handled by url_launcher.
  Future<NavigationActionPolicy?> _shouldOverrideUrlLoadingAsync(
    InAppWebViewController controller,
    NavigationAction navigationAction,
  ) async {
    final url = navigationAction.request.url;
    if (url == null) return NavigationActionPolicy.ALLOW;

    final urlStr = url.toString();

    // Handle special URI schemes
    if (urlStr.startsWith('tel:') ||
        urlStr.startsWith('mailto:') ||
        urlStr.startsWith('sms:')) {
      launchUrl(url);
      return NavigationActionPolicy.CANCEL;
    }

    // Allow internal URLs in the WebView
    if (urlStr.startsWith(AppConfig.webAppUrl)) {
      return NavigationActionPolicy.ALLOW;
    }

    // Open external URLs in the system browser
    if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
      launchUrl(url);
      return NavigationActionPolicy.CANCEL;
    }

    return NavigationActionPolicy.ALLOW;
  }

  /// Forwards WebView console messages to the native logger.
  void _onConsoleMessage(
    InAppWebViewController controller,
    ConsoleMessage consoleMessage,
  ) {
    final level = consoleMessage.messageLevel;
    final message = '[WebView Console] ${consoleMessage.message}';

    switch (level) {
      case ConsoleMessageLevel.LOG:
        AppLogger.debug(message);
      case ConsoleMessageLevel.TIP:
        AppLogger.info(message);
      case ConsoleMessageLevel.WARNING:
        AppLogger.warning(message);
      case ConsoleMessageLevel.ERROR:
        AppLogger.error(message);
      case ConsoleMessageLevel.DEBUG:
        AppLogger.debug(message);
    }
  }
}
