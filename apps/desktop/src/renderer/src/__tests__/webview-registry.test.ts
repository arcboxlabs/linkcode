import type { WebviewTag } from 'electron';
import { describe, expect, it } from 'vitest';
import {
  advanceBrowserWebviewGeneration,
  getBrowserWebviewGeneration,
  getReadyBrowserWebview,
  markBrowserWebviewReady,
  markBrowserWebviewUnready,
  registerBrowserWebview,
} from '../shell/browser/webview-registry';

describe('browser webview registry', () => {
  it('waits for a webview that has not mounted yet', async () => {
    const webview: WebviewTag = Object.create(null);
    const ready = getReadyBrowserWebview('late-tab');
    registerBrowserWebview('late-tab', webview);
    markBrowserWebviewReady('late-tab');

    await expect(ready).resolves.toEqual({ webview, generation: 0 });
    registerBrowserWebview('late-tab', null);
  });

  it('waits for the current document and tracks navigation generation', async () => {
    const webview: WebviewTag = Object.create(null);
    registerBrowserWebview('tab', webview);
    let settled = false;
    const initial = getReadyBrowserWebview('tab').then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    markBrowserWebviewReady('tab');
    await expect(initial).resolves.toEqual({ webview, generation: 0 });
    markBrowserWebviewUnready('tab');
    advanceBrowserWebviewGeneration('tab');
    const navigated = getReadyBrowserWebview('tab');
    markBrowserWebviewReady('tab');

    await expect(navigated).resolves.toEqual({ webview, generation: 1 });
    expect(getBrowserWebviewGeneration('tab')).toBe(1);
    registerBrowserWebview('tab', null);
  });

  it('stops waiting when an unready webview is removed', async () => {
    const webview: WebviewTag = Object.create(null);
    registerBrowserWebview('removed-tab', webview);
    const ready = getReadyBrowserWebview('removed-tab');

    registerBrowserWebview('removed-tab', null);

    await expect(ready).resolves.toBeUndefined();
  });

  it('follows a replacement webview until it is ready', async () => {
    const previous: WebviewTag = Object.create(null);
    const replacement: WebviewTag = Object.create(null);
    registerBrowserWebview('replaced-tab', previous);
    const ready = getReadyBrowserWebview('replaced-tab');

    registerBrowserWebview('replaced-tab', replacement);
    markBrowserWebviewReady('replaced-tab');

    await expect(ready).resolves.toEqual({ webview: replacement, generation: 0 });
    registerBrowserWebview('replaced-tab', null);
  });
});
