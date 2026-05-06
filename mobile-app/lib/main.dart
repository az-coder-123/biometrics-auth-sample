import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'features/webview/pages/webview_page.dart';

/// Entry point for the biometrics authentication sample mobile application.
///
/// This application demonstrates:
/// - WebView integration with the Next.js frontend
/// - Hardware-backed biometric authentication via JavaScript bridge
/// - Log forwarding from WebView to native logger
void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize InAppWebView (required before any WebView usage)
  await InAppWebViewController.setWebContentsDebuggingEnabled(true);

  runApp(const BiometricsAuthApp());
}

/// Root application widget.
///
/// Configures the Material app theme and sets the WebView page
/// as the home screen. The entire web application runs inside the
/// WebView, with native biometric operations exposed via JS bridge.
class BiometricsAuthApp extends StatelessWidget {
  const BiometricsAuthApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Biometrics Auth',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorSchemeSeed: Colors.indigo,
        useMaterial3: true,
        brightness: Brightness.light,
      ),
      home: const WebViewPage(),
    );
  }
}
