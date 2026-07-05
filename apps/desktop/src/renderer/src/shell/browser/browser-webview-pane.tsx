import { BrowserPane } from '@linkcode/ui/shell/browser';
import type { WebviewTag } from 'electron';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useDesktopShellStore } from '../store/store';

/** All in-app pages share one persisted session (cookies/storage survive restarts). */
const BROWSER_PARTITION = 'persist:linkcode-browser';

interface WebviewNavState {
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  failure: string | null;
}

const IDLE_NAV: WebviewNavState = {
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  failure: null,
};

/**
 * The Browser section's Electron `<webview>`. Mounted once inside the shell's resident
 * panel-content stack (never unmounted on section switches — moving a webview in the
 * DOM reloads it), showing/hiding via the stack's visibility toggle.
 */
export function BrowserWebviewPane(): React.ReactNode {
  const t = useTranslations('workbench.preview.browser');
  const url = useDesktopShellStore((state) => state.rightPanel.browser.url);
  const setBrowserUrl = useDesktopShellStore((state) => state.setBrowserUrl);
  const [webview, setWebview] = useState<WebviewTag | null>(null);
  const [nav, setNav] = useState<WebviewNavState>(IDLE_NAV);
  // React's built-in `webview` intrinsic types the element as a bare HTMLWebViewElement;
  // in Electron (webviewTag enabled) the live element is always the full WebviewTag.
  const captureWebview = (element: HTMLWebViewElement | null): void => {
    setWebview(element as WebviewTag | null);
  };

  useAbortableEffect(
    (signal) => {
      if (webview === null) return;
      const sync = (): void => {
        if (signal.aborted) return;
        setNav((prev) => ({
          ...prev,
          isLoading: webview.isLoading(),
          canGoBack: webview.canGoBack(),
          canGoForward: webview.canGoForward(),
        }));
      };
      const onNavigate = (event: Electron.DidNavigateEvent): void => {
        if (!signal.aborted) setBrowserUrl(event.url);
        setNav((prev) => ({ ...prev, failure: null }));
        sync();
      };
      const onFail = (event: Electron.DidFailLoadEvent): void => {
        // -3 = ERR_ABORTED: fired for cancelled loads (e.g. quick re-navigation), not real failures.
        if (event.errorCode === -3 || !event.isMainFrame || signal.aborted) return;
        setNav((prev) => ({
          ...prev,
          failure: t('loadFailed', { error: event.errorDescription }),
        }));
      };
      webview.addEventListener('did-start-loading', sync);
      webview.addEventListener('did-stop-loading', sync);
      webview.addEventListener('did-navigate', onNavigate);
      webview.addEventListener('did-navigate-in-page', onNavigate);
      webview.addEventListener('did-fail-load', onFail);
      return () => {
        webview.removeEventListener('did-start-loading', sync);
        webview.removeEventListener('did-stop-loading', sync);
        webview.removeEventListener('did-navigate', onNavigate);
        webview.removeEventListener('did-navigate-in-page', onNavigate);
        webview.removeEventListener('did-fail-load', onFail);
      };
    },
    [webview, setBrowserUrl, t],
  );

  return (
    <BrowserPane
      url={url}
      isLoading={nav.isLoading}
      canGoBack={nav.canGoBack}
      canGoForward={nav.canGoForward}
      failure={nav.failure}
      onNavigate={(next) => setBrowserUrl(next)}
      onBack={() => webview?.goBack()}
      onForward={() => webview?.goForward()}
      onReload={() => webview?.reload()}
    >
      {url !== null && (
        <webview
          ref={captureWebview}
          src={url}
          partition={BROWSER_PARTITION}
          allowpopups
          className="h-full w-full"
        />
      )}
    </BrowserPane>
  );
}
