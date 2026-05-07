/**
 * TypeScript declarations for the flutter_inappwebview JavaScript bridge.
 *
 * The InAppWebView Flutter plugin injects this object onto `window` when
 * the web app runs inside the mobile WebView. These declarations enable
 * type-safe access to the bridge from the frontend code.
 */

interface InAppWebViewBridge {
  /**
   * Calls a registered JavaScript handler on the native side.
   *
   * @param handlerName - The registered handler name
   * @param args - Positional arguments forwarded to the native handler
   * @returns Promise resolving to the handler's return value
   */
  callHandler(handlerName: string, ...args: unknown[]): Promise<unknown>;
}

interface Window {
  /**
   * Injected by the Flutter InAppWebView plugin when the page runs inside
   * the mobile app WebView. Absent in regular browsers — always guard with
   * `isNativeApp()` before calling any handler.
   */
  flutter_inappwebview?: InAppWebViewBridge;
}