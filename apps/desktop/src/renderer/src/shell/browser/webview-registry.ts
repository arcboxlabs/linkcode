import type { WebviewTag } from 'electron';
import { noop } from 'foxts/noop';

/**
 * Live `<webview>` elements by browser-tab id. Panes register on mount so the browser command
 * executor can drive the same webviews the user sees; entries exist only while a tab has a URL
 * (an empty tab renders no webview).
 */
interface WebviewEntry {
  webview: WebviewTag;
  generation: number;
  ready: Promise<void>;
  resolveReady: () => void;
}

const webviews = new Map<string, WebviewEntry>();
const registrationWaiters = new Map<string, Set<(entry: WebviewEntry | undefined) => void>>();

function unreadyEntry(webview: WebviewTag, generation: number): WebviewEntry {
  let resolveReady = noop;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  return { webview, generation, ready, resolveReady };
}

export function registerBrowserWebview(tabId: string, webview: WebviewTag | null): void {
  const previous = webviews.get(tabId);
  const entry = webview === null ? undefined : unreadyEntry(webview, 0);
  if (entry) webviews.set(tabId, entry);
  else webviews.delete(tabId);
  // Wake callers waiting on an entry that was removed or replaced so they can follow the map.
  previous?.resolveReady();
  const waiters = registrationWaiters.get(tabId);
  if (waiters != null) {
    for (const resolve of waiters) resolve(entry);
  }
  registrationWaiters.delete(tabId);
}

export function markBrowserWebviewUnready(tabId: string): void {
  const entry = webviews.get(tabId);
  if (entry) {
    // Wake callers waiting on the superseded readiness promise; they re-read the current entry.
    entry.resolveReady();
    webviews.set(tabId, unreadyEntry(entry.webview, entry.generation));
  }
}

export function markBrowserWebviewReady(tabId: string): void {
  webviews.get(tabId)?.resolveReady();
}

export function advanceBrowserWebviewGeneration(tabId: string): void {
  const entry = webviews.get(tabId);
  if (entry) entry.generation += 1;
}

export function getBrowserWebviewGeneration(tabId: string): number | undefined {
  return webviews.get(tabId)?.generation;
}

export async function getReadyBrowserWebview(
  tabId: string,
): Promise<{ webview: WebviewTag; generation: number } | undefined> {
  let entry = webviews.get(tabId);
  if (!entry) {
    entry = await new Promise<WebviewEntry | undefined>((resolve) => {
      const waiters = registrationWaiters.get(tabId) ?? new Set();
      waiters.add(resolve);
      registrationWaiters.set(tabId, waiters);
    });
  }
  while (entry) {
    await entry.ready;
    const current = webviews.get(tabId);
    if (current === entry) return { webview: entry.webview, generation: entry.generation };
    entry = current;
  }
  return undefined;
}
