import { BrowserPane } from '@linkcode/ui/shell/browser';
import type { WebviewTag } from 'electron';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { noop } from 'foxts/noop';
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
 * One browser tab's Electron `<webview>`, mounted once inside the shell's resident
 * panel-content stack (moving a webview in the DOM reloads it) and shown/hidden via visibility.
 */
export function BrowserWebviewPane({
  tabId,
  url,
}: {
  tabId: string;
  url: string | null;
}): React.ReactNode {
  const t = useTranslations('workbench.preview.browser');
  const setBrowserTabUrl = useDesktopShellStore((state) => state.setBrowserTabUrl);
  const setBrowserTabTitle = useDesktopShellStore((state) => state.setBrowserTabTitle);
  // Every tab is a permanent resident (unmounting/DOM-moving it reloads), so inactive tabs and
  // a hidden browser section must pause media that would otherwise keep playing out of sight.
  const visible = useDesktopShellStore(
    (state) =>
      state.rightPanel.open &&
      state.rightPanel.activeSection === 'browser' &&
      state.rightPanel.browser.activeTabId === tabId,
  );
  const [webview, setWebview] = useState<WebviewTag | null>(null);
  const [nav, setNav] = useState<WebviewNavState>(IDLE_NAV);
  // React's built-in `webview` intrinsic types the element as a bare HTMLWebViewElement;
  // in Electron (webviewTag enabled) the live element is always the full WebviewTag.
  const captureWebview = (element: HTMLWebViewElement | null): void => {
    // React 19 rejects a boolean value for this custom content attribute. Electron only
    // cares about its presence, so set it directly before the guest navigation begins.
    element?.toggleAttribute('allowpopups', true);
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
        if (!signal.aborted) setBrowserTabUrl(tabId, event.url);
        setNav((prev) => ({ ...prev, failure: null }));
        sync();
      };
      const onTitleUpdated = (event: Electron.PageTitleUpdatedEvent): void => {
        if (!signal.aborted) setBrowserTabTitle(tabId, event.title);
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
      webview.addEventListener('page-title-updated', onTitleUpdated);
      webview.addEventListener('did-fail-load', onFail);
      return () => {
        webview.removeEventListener('did-start-loading', sync);
        webview.removeEventListener('did-stop-loading', sync);
        webview.removeEventListener('did-navigate', onNavigate);
        webview.removeEventListener('did-navigate-in-page', onNavigate);
        webview.removeEventListener('page-title-updated', onTitleUpdated);
        webview.removeEventListener('did-fail-load', onFail);
      };
    },
    [webview, tabId, setBrowserTabUrl, setBrowserTabTitle, t],
  );

  // Pause any playing media when the pane is hidden (panel collapsed or another section shown),
  // so a preview stops instead of playing audio out of sight. Paused, not resumed — the user
  // restarts it on their next visit.
  useAbortableEffect(() => {
    if (webview === null || visible) return;
    // Guest may be mid-navigation or detached, in which case there is nothing to pause.
    webview
      .executeJavaScript('document.querySelectorAll("video,audio").forEach((m) => m.pause())')
      .catch(noop);
  }, [webview, visible]);

  return (
    <BrowserPane
      url={url}
      isLoading={nav.isLoading}
      canGoBack={nav.canGoBack}
      canGoForward={nav.canGoForward}
      failure={nav.failure}
      onNavigate={(next) => setBrowserTabUrl(tabId, next)}
      onBack={() => webview?.goBack()}
      onForward={() => webview?.goForward()}
      onReload={() => webview?.reload()}
    >
      {url !== null && (
        <webview
          ref={captureWebview}
          src={url}
          partition={BROWSER_PARTITION}
          className="h-full w-full"
        />
      )}
    </BrowserPane>
  );
}
