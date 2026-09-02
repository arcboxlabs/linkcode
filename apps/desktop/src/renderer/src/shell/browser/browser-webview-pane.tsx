import type { SystemBridge } from '@linkcode/ipc';
import { isKeyboardShortcutLocalTarget, useKeyboardShortcut } from '@linkcode/ui';
import type { BrowserFindState } from '@linkcode/ui/shell/browser';
import { BrowserPane } from '@linkcode/ui/shell/browser';
import type { WebviewTag } from 'electron';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { noop } from 'foxts/noop';
import { useCallback, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import { useDesktopShellStore } from '../store/store';
import {
  advanceBrowserWebviewGeneration,
  isBrowserWebviewReady,
  markBrowserWebviewReady,
  markBrowserWebviewUnready,
  registerBrowserWebview,
} from './webview-registry';

/** All in-app pages share one persisted session (cookies/storage survive restarts). */
const BROWSER_PARTITION = 'persist:linkcode-browser';

/** Guest events after which the nav/readiness snapshots must be re-read. */
const GUEST_NAV_EVENTS = [
  'did-start-loading',
  'did-stop-loading',
  'dom-ready',
  'did-start-navigation',
  'did-navigate',
  'did-navigate-in-page',
] as const;

/** An absent or still-attaching guest (methods throw until dom-ready) reads as idle. */
function readGuest(webview: WebviewTag | null, read: (view: WebviewTag) => boolean): boolean {
  if (webview === null) return false;
  try {
    return read(webview);
  } catch {
    return false;
  }
}

/** Forward every nav-affecting guest event to `onStoreChange`; returns the detach. */
function subscribeGuestNav(webview: WebviewTag | null, onStoreChange: () => void): () => void {
  if (webview === null) return noop;
  for (let i = 0, len = GUEST_NAV_EVENTS.length; i < len; i++) {
    webview.addEventListener(GUEST_NAV_EVENTS[i], onStoreChange);
  }
  return () => {
    for (let i = 0, len = GUEST_NAV_EVENTS.length; i < len; i++) {
      webview.removeEventListener(GUEST_NAV_EVENTS[i], onStoreChange);
    }
  };
}

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

function pauseWebviewMedia(webview: WebviewTag): void {
  // Guest may detach after the readiness check, in which case there is nothing to pause.
  void Promise.resolve()
    .then(() =>
      webview.executeJavaScript(
        'document.querySelectorAll("video,audio").forEach((m) => m.pause())',
      ),
    )
    .catch(noop);
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
  // React's built-in `webview` intrinsic types the element as a bare HTMLWebViewElement;
  // in Electron (webviewTag enabled) the live element is always the full WebviewTag.
  const captureWebview = useCallback(
    (element: HTMLWebViewElement | null) => setWebview(element as WebviewTag | null),
    [],
  );

  useLayoutEffect(() => {
    if (webview === null) return;
    registerBrowserWebview(tabId, webview);
    return () => registerBrowserWebview(tabId, null);
  }, [tabId, webview]);

  const [failureError, setFailureError] = useState<string | null>(null);
  const [find, setFind] = useState<BrowserFindState | null>(null);

  const syncDocumentState = useEffectEvent((currentUrl: string, currentTitle: string) => {
    if (currentUrl.length > 0) setBrowserTabUrl(tabId, currentUrl);
    if (currentTitle.length > 0) setBrowserTabTitle(tabId, currentTitle);
  });

  // Command side: guest events drive the registry marks, the shell store's url/title, and the
  // event-payload-only states (load failure, find matches) that no webview getter can serve.
  useLayoutEffect(() => {
    if (webview === null) return;
    const syncDocument = (): void => {
      markBrowserWebviewReady(tabId);
      syncDocumentState(webview.getURL(), webview.getTitle());
    };
    const onNavigate = (event: Electron.DidNavigateEvent): void => {
      advanceBrowserWebviewGeneration(tabId);
      syncDocumentState(event.url, '');
      setFailureError(null);
    };
    const onStartNavigation = (event: Electron.DidStartNavigationEvent): void => {
      if (!event.isMainFrame || event.isInPlace) return;
      markBrowserWebviewUnready(tabId);
    };
    const onTitleUpdated = (event: Electron.PageTitleUpdatedEvent): void => {
      syncDocumentState('', event.title);
    };
    const onFail = (event: Electron.DidFailLoadEvent): void => {
      // -3 = ERR_ABORTED: fired for cancelled loads (e.g. quick re-navigation), not real failures.
      if (event.errorCode === -3 || !event.isMainFrame) return;
      setFailureError(event.errorDescription);
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
    // `dom-ready` can fire before this effect subscribes on very fast pages. The later
    // `did-stop-loading` is an equivalent safe point for guest methods and closes that race.
    webview.addEventListener('did-stop-loading', syncDocument);
    webview.addEventListener('dom-ready', syncDocument);
    webview.addEventListener('did-start-navigation', onStartNavigation);
    webview.addEventListener('did-navigate', onNavigate);
    webview.addEventListener('did-navigate-in-page', onNavigate);
    webview.addEventListener('page-title-updated', onTitleUpdated);
    webview.addEventListener('did-fail-load', onFail);
    webview.addEventListener('found-in-page', onFoundInPage);
    // A cached page can finish before either readiness listener is attached. Probe only after all
    // listeners are installed; an attaching guest may still throw, in which case an event wins.
    try {
      if (!webview.isLoading() && webview.getURL().length > 0) syncDocument();
    } catch {
      noop();
    }
    return () => {
      webview.removeEventListener('did-stop-loading', syncDocument);
      webview.removeEventListener('dom-ready', syncDocument);
      webview.removeEventListener('did-start-navigation', onStartNavigation);
      webview.removeEventListener('did-navigate', onNavigate);
      webview.removeEventListener('did-navigate-in-page', onNavigate);
      webview.removeEventListener('page-title-updated', onTitleUpdated);
      webview.removeEventListener('did-fail-load', onFail);
      webview.removeEventListener('found-in-page', onFoundInPage);
    };
  }, [webview, tabId]);

  // Query side: the webview itself is the store. Subscribing just forwards guest events to
  // React, and each snapshot reads the element (or the registry's readiness mark) directly —
  // the post-subscribe snapshot re-read makes a pre-subscription load impossible to miss.
  const isLoading = useSyncExternalStore(
    useCallback(
      (onStoreChange: () => void) => subscribeGuestNav(webview, onStoreChange),
      [webview],
    ),
    () => readGuest(webview, (view) => view.isLoading()),
  );
  const canGoBack = useSyncExternalStore(
    useCallback(
      (onStoreChange: () => void) => subscribeGuestNav(webview, onStoreChange),
      [webview],
    ),
    () => readGuest(webview, (view) => view.canGoBack()),
  );
  const canGoForward = useSyncExternalStore(
    useCallback(
      (onStoreChange: () => void) => subscribeGuestNav(webview, onStoreChange),
      [webview],
    ),
    () => readGuest(webview, (view) => view.canGoForward()),
  );
  const guestReady = useSyncExternalStore(
    useCallback(
      (onStoreChange: () => void) => subscribeGuestNav(webview, onStoreChange),
      [webview],
    ),
    () => webview !== null && isBrowserWebviewReady(tabId),
  );

  // Pause playing media when the pane is hidden; gated on dom-ready to avoid pre-attachment throws.
  useLayoutEffect(() => {
    if (webview === null || !guestReady) return;
    const isVisible = (): boolean => {
      const panel = useDesktopShellStore.getState().rightPanel;
      return panel.open && panel.activeSection === 'browser' && panel.browser.activeTabId === tabId;
    };
    let wasVisible = isVisible();
    if (!wasVisible) pauseWebviewMedia(webview);
    return useDesktopShellStore.subscribe(() => {
      const nextVisible = isVisible();
      if (wasVisible && !nextVisible) pauseWebviewMedia(webview);
      wasVisible = nextVisible;
    });
  }, [webview, guestReady, tabId]);

  const openFind = (): void => {
    setFind((prev) => prev ?? { query: '', matches: null });
  };
  const closeFind = (): void => {
    if (guestReady) webview?.stopFindInPage('clearSelection');
    setFind(null);
  };
  const changeFindQuery = (query: string): void => {
    setFind({ query, matches: null });
    if (!guestReady) return;
    if (query.length > 0) webview?.findInPage(query);
    else webview?.stopFindInPage('clearSelection');
  };
  const stepFind = (forward: boolean): void => {
    if (guestReady && find !== null && find.query.length > 0) {
      webview?.findInPage(find.query, { forward, findNext: true });
    }
  };
  const zoom = (action: 'in' | 'out' | 'reset'): void => {
    applyZoom(webview, guestReady, action);
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
          applyZoom(webview, guestReady, 'in');
          break;
        case 'zoom-out':
          applyZoom(webview, guestReady, 'out');
          break;
        case 'zoom-reset':
          applyZoom(webview, guestReady, 'reset');
          break;
        default:
          break;
      }
    });
  }, [systemBridge, tabId, visible, webview, guestReady]);

  return (
    <div ref={rootRef} className="h-full min-h-0">
      <BrowserPane
        url={url}
        isLoading={isLoading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        failure={failureError === null ? null : t('loadFailed', { error: failureError })}
        find={find}
        onNavigate={(next) => setBrowserTabUrl(tabId, next)}
        onBack={() => guestReady && webview?.goBack()}
        onForward={() => guestReady && webview?.goForward()}
        onReload={() => guestReady && webview?.reload()}
        onFindQueryChange={changeFindQuery}
        onFindStep={stepFind}
        onFindClose={closeFind}
        onOpenFind={openFind}
        onZoom={zoom}
        onOpenDevTools={() => guestReady && webview?.openDevTools()}
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
