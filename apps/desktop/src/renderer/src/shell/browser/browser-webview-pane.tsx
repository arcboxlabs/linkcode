import { isKeyboardShortcutLocalTarget, useKeyboardShortcut } from '@linkcode/ui';
import type { BrowserFindState } from '@linkcode/ui/shell/browser';
import { BrowserPane } from '@linkcode/ui/shell/browser';
import type { WebviewTag } from 'electron';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useRef, useState } from 'react';
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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [webview, setWebview] = useState<WebviewTag | null>(null);
  const [nav, setNav] = useState<WebviewNavState>(IDLE_NAV);
  const [find, setFind] = useState<BrowserFindState | null>(null);
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
      const onFoundInPage = (event: Electron.FoundInPageEvent): void => {
        if (signal.aborted) return;
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
      webview.addEventListener('did-navigate', onNavigate);
      webview.addEventListener('did-navigate-in-page', onNavigate);
      webview.addEventListener('page-title-updated', onTitleUpdated);
      webview.addEventListener('did-fail-load', onFail);
      webview.addEventListener('found-in-page', onFoundInPage);
      return () => {
        webview.removeEventListener('did-start-loading', sync);
        webview.removeEventListener('did-stop-loading', sync);
        webview.removeEventListener('did-navigate', onNavigate);
        webview.removeEventListener('did-navigate-in-page', onNavigate);
        webview.removeEventListener('page-title-updated', onTitleUpdated);
        webview.removeEventListener('did-fail-load', onFail);
        webview.removeEventListener('found-in-page', onFoundInPage);
      };
    },
    [webview, tabId, setBrowserTabUrl, setBrowserTabTitle, t],
  );

  const openFind = (): void => {
    setFind((prev) => prev ?? { query: '', matches: null });
  };
  const closeFind = (): void => {
    webview?.stopFindInPage('clearSelection');
    setFind(null);
  };
  const changeFindQuery = (query: string): void => {
    setFind({ query, matches: null });
    if (query.length > 0) webview?.findInPage(query);
    else webview?.stopFindInPage('clearSelection');
  };
  const stepFind = (forward: boolean): void => {
    if (find !== null && find.query.length > 0) {
      webview?.findInPage(find.query, { forward, findNext: true });
    }
  };
  const zoom = (action: 'in' | 'out' | 'reset'): void => {
    if (webview === null) return;
    const level = webview.getZoomLevel();
    if (action === 'in') webview.setZoomLevel(Math.min(level + 1, MAX_ZOOM_LEVEL));
    else if (action === 'out') webview.setZoomLevel(Math.max(level - 1, MIN_ZOOM_LEVEL));
    else webview.setZoomLevel(0);
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
        onBack={() => webview?.goBack()}
        onForward={() => webview?.goForward()}
        onReload={() => webview?.reload()}
        onFindQueryChange={changeFindQuery}
        onFindStep={stepFind}
        onFindClose={closeFind}
        onOpenFind={openFind}
        onZoom={zoom}
        onOpenDevTools={() => webview?.openDevTools()}
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
