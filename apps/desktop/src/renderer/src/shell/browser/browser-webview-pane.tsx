import type { SystemBridge } from '@linkcode/ipc';
import { isKeyboardShortcutLocalTarget, useKeyboardShortcut } from '@linkcode/ui';
import type { BrowserFindState } from '@linkcode/ui/shell/browser';
import { BrowserPane } from '@linkcode/ui/shell/browser';
import type { WebviewTag } from 'electron';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { noop } from 'foxts/noop';
import { useEffectEvent, useRef, useState } from 'react';
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

function whenNotLocal(event: KeyboardEvent): boolean {
  return !isKeyboardShortcutLocalTarget(event.target);
}

/** Chromium's supported zoom-level range (each level is a 1.2× factor step). */
const MIN_ZOOM_LEVEL = -8;
const MAX_ZOOM_LEVEL = 9;

function applyZoom(
  webview: WebviewTag | null,
  ready: boolean,
  action: 'in' | 'out' | 'reset',
): void {
  if (webview === null || !ready) return;
  const level = webview.getZoomLevel();
  if (action === 'in') webview.setZoomLevel(Math.min(level + 1, MAX_ZOOM_LEVEL));
  else if (action === 'out') webview.setZoomLevel(Math.max(level - 1, MIN_ZOOM_LEVEL));
  else webview.setZoomLevel(0);
}

/**
 * One browser tab's Electron `<webview>`, mounted once inside the shell's resident
 * panel-content stack (moving a webview in the DOM reloads it) and shown/hidden via visibility.
 */
export function BrowserWebviewPane({
  systemBridge,
  tabId,
  url,
}: {
  systemBridge: SystemBridge;
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [webview, setWebview] = useState<WebviewTag | null>(null);
  const [webviewReady, setWebviewReady] = useState(false);
  const [nav, setNav] = useState<WebviewNavState>(IDLE_NAV);
  const [find, setFind] = useState<BrowserFindState | null>(null);
  // React's built-in `webview` intrinsic types the element as a bare HTMLWebViewElement;
  // in Electron (webviewTag enabled) the live element is always the full WebviewTag.
  const captureWebview = (element: HTMLWebViewElement | null): void => {
    setWebviewReady(false);
    setWebview(element as WebviewTag | null);
  };

  const syncDocumentState = useEffectEvent((currentUrl: string, currentTitle: string) => {
    if (currentUrl.length > 0) setBrowserTabUrl(tabId, currentUrl);
    if (currentTitle.length > 0) setBrowserTabTitle(tabId, currentTitle);
  });
  const reportLoadFailure = useEffectEvent((description: string) => {
    setNav((prev) => ({ ...prev, failure: t('loadFailed', { error: description }) }));
  });

  useLayoutEffect(() => {
    if (webview === null) return;
    let ready = false;
    const sync = (): void => {
      if (!ready) return;
      setNav((prev) => ({
        ...prev,
        isLoading: webview.isLoading(),
        canGoBack: webview.canGoBack(),
        canGoForward: webview.canGoForward(),
      }));
    };
    const syncDocument = (): void => {
      ready = true;
      setWebviewReady(true);
      sync();
      syncDocumentState(webview.getURL(), webview.getTitle());
    };
    const onNavigate = (event: Electron.DidNavigateEvent): void => {
      syncDocumentState(event.url, '');
      setNav((prev) => ({ ...prev, failure: null }));
      sync();
    };
    const onTitleUpdated = (event: Electron.PageTitleUpdatedEvent): void => {
      syncDocumentState('', event.title);
    };
    const onFail = (event: Electron.DidFailLoadEvent): void => {
      // -3 = ERR_ABORTED: fired for cancelled loads (e.g. quick re-navigation), not real failures.
      if (event.errorCode === -3 || !event.isMainFrame) return;
      reportLoadFailure(event.errorDescription);
    };
    const onFoundInPage = (event: Electron.FoundInPageEvent): void => {
      setFind((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              matches: { active: event.result.activeMatchOrdinal, total: event.result.matches },
            },
      );
    };
    webview.addEventListener('did-start-loading', sync);
    webview.addEventListener('did-stop-loading', sync);
    webview.addEventListener('dom-ready', syncDocument);
    webview.addEventListener('did-navigate', onNavigate);
    webview.addEventListener('did-navigate-in-page', onNavigate);
    webview.addEventListener('page-title-updated', onTitleUpdated);
    webview.addEventListener('did-fail-load', onFail);
    webview.addEventListener('found-in-page', onFoundInPage);
    return () => {
      webview.removeEventListener('did-start-loading', sync);
      webview.removeEventListener('did-stop-loading', sync);
      webview.removeEventListener('dom-ready', syncDocument);
      webview.removeEventListener('did-navigate', onNavigate);
      webview.removeEventListener('did-navigate-in-page', onNavigate);
      webview.removeEventListener('page-title-updated', onTitleUpdated);
      webview.removeEventListener('did-fail-load', onFail);
      webview.removeEventListener('found-in-page', onFoundInPage);
    };
  }, [webview]);

  // Pause any playing media when the pane is hidden (panel collapsed or another section shown),
  // so a preview stops instead of playing audio out of sight. Paused, not resumed — the user
  // restarts it on their next visit.
  useAbortableEffect(() => {
    if (webview === null || !webviewReady || visible) return;
    // Guest may detach after the readiness check, in which case there is nothing to pause.
    void Promise.resolve()
      .then(() =>
        webview.executeJavaScript(
          'document.querySelectorAll("video,audio").forEach((m) => m.pause())',
        ),
      )
      .catch(noop);
  }, [webview, webviewReady, visible]);

  const openFind = (): void => {
    setFind((prev) => prev ?? { query: '', matches: null });
  };
  const closeFind = (): void => {
    if (webviewReady) webview?.stopFindInPage('clearSelection');
    setFind(null);
  };
  const changeFindQuery = (query: string): void => {
    setFind({ query, matches: null });
    if (!webviewReady) return;
    if (query.length > 0) webview?.findInPage(query);
    else webview?.stopFindInPage('clearSelection');
  };
  const stepFind = (forward: boolean): void => {
    if (webviewReady && find !== null && find.query.length > 0) {
      webview?.findInPage(find.query, { forward, findNext: true });
    }
  };
  const zoom = (action: 'in' | 'out' | 'reset'): void => {
    applyZoom(webview, webviewReady, action);
  };

  // Owner-scoped chords: the registry only fires these while this tab's pane is the
  // visible (non-inert) item of the resident stack.
  useKeyboardShortcut({
    actionId: 'browser.find',
    shortcut: { code: 'KeyF', modifiers: ['primary'] },
    owner: rootRef,
    when: whenNotLocal,
    handler() {
      openFind();
      return true;
    },
  });
  useKeyboardShortcut({
    actionId: 'browser.zoom-in',
    shortcut: { code: 'Equal', modifiers: ['primary'] },
    owner: rootRef,
    when: whenNotLocal,
    handler() {
      zoom('in');
      return true;
    },
  });
  useKeyboardShortcut({
    actionId: 'browser.zoom-out',
    shortcut: { code: 'Minus', modifiers: ['primary'] },
    owner: rootRef,
    when: whenNotLocal,
    handler() {
      zoom('out');
      return true;
    },
  });
  useKeyboardShortcut({
    actionId: 'browser.zoom-reset',
    shortcut: { code: 'Digit0', modifiers: ['primary'] },
    owner: rootRef,
    when: whenNotLocal,
    handler() {
      zoom('reset');
      return true;
    },
  });

  useLayoutEffect(() => {
    if (!visible) return;
    return systemBridge.browser.onShortcut((action) => {
      const panel = useDesktopShellStore.getState().rightPanel;
      if (!panel.open || panel.activeSection !== 'browser' || panel.browser.activeTabId !== tabId) {
        return;
      }
      switch (action) {
        case 'find':
          setFind((prev) => prev ?? { query: '', matches: null });
          break;
        case 'zoom-in':
          applyZoom(webview, webviewReady, 'in');
          break;
        case 'zoom-out':
          applyZoom(webview, webviewReady, 'out');
          break;
        case 'zoom-reset':
          applyZoom(webview, webviewReady, 'reset');
          break;
        default:
          break;
      }
    });
  }, [systemBridge, tabId, visible, webview, webviewReady]);

  return (
    <div ref={rootRef} className="h-full min-h-0">
      <BrowserPane
        url={url}
        isLoading={nav.isLoading}
        canGoBack={nav.canGoBack}
        canGoForward={nav.canGoForward}
        failure={nav.failure}
        find={find}
        onNavigate={(next) => setBrowserTabUrl(tabId, next)}
        onBack={() => webviewReady && webview?.goBack()}
        onForward={() => webviewReady && webview?.goForward()}
        onReload={() => webviewReady && webview?.reload()}
        onFindQueryChange={changeFindQuery}
        onFindStep={stepFind}
        onFindClose={closeFind}
        onOpenFind={openFind}
        onZoom={zoom}
        onOpenDevTools={() => webviewReady && webview?.openDevTools()}
      >
        {url !== null && (
          <webview
            ref={captureWebview}
            src={url}
            partition={BROWSER_PARTITION}
            // Must be present BEFORE the element attaches — Electron snapshots webview params at
            // attach time, and a post-mount toggle leaves popups silently blocked (the guest
            // window-open handler is then never consulted; verified via main-process probe).
            // @ts-expect-error -- React types this boolean, but React 19 only forwards the
            // string form; the empty string is the boolean-attribute-present form.
            allowpopups=""
            className="h-full w-full"
          />
        )}
      </BrowserPane>
    </div>
  );
}
