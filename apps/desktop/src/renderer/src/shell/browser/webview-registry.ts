import type { WebviewTag } from 'electron';

/**
 * Live `<webview>` elements by browser-tab id. Panes register on mount so the browser command
 * executor can drive the same webviews the user sees; entries exist only while a tab has a URL
 * (an empty tab renders no webview).
 */
const webviews = new Map<string, WebviewTag>();

export function registerBrowserWebview(tabId: string, webview: WebviewTag | null): void {
  if (webview === null) webviews.delete(tabId);
  else webviews.set(tabId, webview);
}

export function getBrowserWebview(tabId: string): WebviewTag | undefined {
  return webviews.get(tabId);
}
