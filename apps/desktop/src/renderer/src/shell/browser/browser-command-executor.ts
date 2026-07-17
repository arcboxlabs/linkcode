import type {
  BrowserCommandArgs,
  BrowserCommandError,
  BrowserCommandErrorCode,
  BrowserCommandResult,
  BrowserOp,
  BrowserSnapshot,
  BrowserTabInfo,
} from '@linkcode/schema';
import { isAllowedBrowserUrl } from '@linkcode/ui/shell/browser';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { z } from 'zod';
import { useDesktopShellStore } from '../store/store';
import { getBrowserWebview } from './webview-registry';

/** Snapshot ref marker attribute; selectors target it so refs survive without CSS-path math. */
const REF_ATTRIBUTE = 'data-linkcode-ref';
const SNAPSHOT_NODE_CAP = 200;

const TabArgsSchema = z.object({ tabId: z.string().min(1) });
const OpenArgsSchema = z.object({ url: z.string().min(1) });
const NavigateArgsSchema = TabArgsSchema.extend({ url: z.string().min(1) });
const RefArgsSchema = TabArgsSchema.extend({ ref: z.string().min(1) });
const TypeArgsSchema = RefArgsSchema.extend({ text: z.string() });
const EvaluateArgsSchema = TabArgsSchema.extend({ js: z.string().min(1) });

interface SnapshotRecord {
  url: string;
  refs: Set<string>;
}

const SNAPSHOT_SCRIPT = `(() => {
  const SELECTOR = 'a[href], button, input, textarea, select, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="combobox"], [role="menuitem"], [role="tab"], [contenteditable="true"]';
  for (const el of document.querySelectorAll('[${REF_ATTRIBUTE}]')) el.removeAttribute('${REF_ATTRIBUTE}');
  const nodes = [];
  let truncated = false;
  let n = 0;
  for (const el of document.querySelectorAll(SELECTOR)) {
    if (nodes.length >= ${SNAPSHOT_NODE_CAP}) { truncated = true; break; }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    n += 1;
    const ref = '@e' + n;
    el.setAttribute('${REF_ATTRIBUTE}', ref);
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || (tag === 'input' ? 'input:' + (el.getAttribute('type') || 'text') : tag);
    const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '').trim().slice(0, 80);
    const node = { ref, role, name };
    if (tag === 'input' || tag === 'textarea' || tag === 'select') node.value = String(el.value ?? '').slice(0, 80);
    nodes.push(node);
  }
  return { url: location.href, title: document.title, nodes, truncated };
})()`;

class CommandError extends Error {
  override name = 'CommandError';

  constructor(
    readonly code: BrowserCommandErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

function listTabs(): BrowserTabInfo[] {
  const { browser } = useDesktopShellStore.getState().rightPanel;
  return browser.tabs.map((tab) => ({
    id: tab.id,
    url: tab.url,
    title: tab.title,
    active: tab.id === browser.activeTabId,
  }));
}

function assertTab(tabId: string): void {
  const { browser } = useDesktopShellStore.getState().rightPanel;
  if (!browser.tabs.some((tab) => tab.id === tabId)) {
    throw new CommandError('no-such-tab', `no browser tab ${tabId}`);
  }
}

function requireWebview(tabId: string) {
  assertTab(tabId);
  const webview = getBrowserWebview(tabId);
  // eslint-disable-next-line sukka/prefer-nullthrow -- the throw must carry a closed BrowserCommandErrorCode, which nullthrow/invariant cannot attach
  if (!webview) {
    throw new CommandError(
      'no-such-tab',
      `tab ${tabId} has no page loaded yet (navigate it first)`,
    );
  }
  return webview;
}

/**
 * Executes broker-dispatched browser ops against the SAME tabs/webviews the user sees:
 * tab management goes through the desktop shell store; page ops run inside the live webview
 * via `executeJavaScript`; screenshots use `capturePage`. Snapshot refs (`@eN`) are marker
 * attributes in the page plus a per-tab record here — a navigation makes them stale.
 */
export class BrowserCommandExecutor {
  private readonly snapshots = new Map<string, SnapshotRecord>();

  async execute(op: BrowserOp, args: BrowserCommandArgs): Promise<BrowserCommandResult> {
    try {
      return { ok: true, data: await this.run(op, args) };
    } catch (err) {
      return { ok: false, error: toCommandError(err) };
    }
  }

  private async run(op: BrowserOp, args: BrowserCommandArgs): Promise<unknown> {
    switch (op) {
      case 'tabs.list':
        return listTabs();
      case 'tabs.open': {
        const { url } = parseArgs(OpenArgsSchema, args);
        assertAllowedUrl(url);
        useDesktopShellStore.getState().openBrowserTab(url);
        return listTabs();
      }
      case 'tabs.select': {
        const { tabId } = parseArgs(TabArgsSchema, args);
        assertTab(tabId);
        const store = useDesktopShellStore.getState();
        store.openRightPanelSection('browser');
        store.setActiveRightBrowserTab(tabId);
        return listTabs();
      }
      case 'tab.navigate': {
        const { tabId, url } = parseArgs(NavigateArgsSchema, args);
        assertTab(tabId);
        assertAllowedUrl(url);
        this.snapshots.delete(tabId);
        useDesktopShellStore.getState().setBrowserTabUrl(tabId, url);
        return null;
      }
      case 'tab.back': {
        const { tabId } = parseArgs(TabArgsSchema, args);
        this.snapshots.delete(tabId);
        requireWebview(tabId).goBack();
        return null;
      }
      case 'tab.reload': {
        const { tabId } = parseArgs(TabArgsSchema, args);
        this.snapshots.delete(tabId);
        requireWebview(tabId).reload();
        return null;
      }
      case 'tab.close': {
        const { tabId } = parseArgs(TabArgsSchema, args);
        assertTab(tabId);
        this.snapshots.delete(tabId);
        useDesktopShellStore.getState().closeRightBrowserTab(tabId);
        return listTabs();
      }
      case 'tab.snapshot':
        return this.snapshot(parseArgs(TabArgsSchema, args).tabId);
      case 'tab.click': {
        const { tabId, ref } = parseArgs(RefArgsSchema, args);
        await this.runOnRef(tabId, ref, clickScript(ref));
        return null;
      }
      case 'tab.type': {
        const { tabId, ref, text } = parseArgs(TypeArgsSchema, args);
        await this.runOnRef(tabId, ref, typeScript(ref, text));
        return null;
      }
      case 'tab.screenshot':
        return screenshot(parseArgs(TabArgsSchema, args).tabId);
      case 'tab.evaluate': {
        const { tabId, js } = parseArgs(EvaluateArgsSchema, args);
        const webview = requireWebview(tabId);
        try {
          return await webview.executeJavaScript(js);
        } catch (err) {
          throw new CommandError('execution-failed', extractErrorMessage(err) ?? 'evaluate failed');
        }
      }
      default:
        throw new CommandError('invalid-args', `unsupported op ${op as string}`);
    }
  }

  private async snapshot(tabId: string): Promise<BrowserSnapshot> {
    const webview = requireWebview(tabId);
    const result = (await webview.executeJavaScript(SNAPSHOT_SCRIPT).catch((err: unknown) => {
      throw new CommandError('execution-failed', extractErrorMessage(err) ?? 'snapshot failed');
    })) as BrowserSnapshot;
    this.snapshots.set(tabId, {
      url: result.url,
      refs: new Set(result.nodes.map((node) => node.ref)),
    });
    return result;
  }

  private async runOnRef(tabId: string, ref: string, script: string): Promise<void> {
    const webview = requireWebview(tabId);
    const record = this.snapshots.get(tabId);
    if (!record?.refs.has(ref)) {
      throw new CommandError('stale-ref', `unknown ref ${ref}; take a fresh tab.snapshot first`);
    }
    if (webview.getURL() !== record.url) {
      this.snapshots.delete(tabId);
      throw new CommandError(
        'stale-ref',
        'the page navigated since the last snapshot; take a fresh tab.snapshot',
        true,
      );
    }
    const found = (await webview.executeJavaScript(script).catch((err: unknown) => {
      throw new CommandError('execution-failed', extractErrorMessage(err) ?? 'interaction failed');
    })) as boolean;
    if (!found) {
      this.snapshots.delete(tabId);
      throw new CommandError(
        'stale-ref',
        `ref ${ref} is gone from the page; take a fresh tab.snapshot`,
        true,
      );
    }
  }
}

async function screenshot(tabId: string): Promise<{ mimeType: string; base64: string }> {
  // capturePage renders the compositor's view: bring the tab forward first so a hidden
  // (visibility-toggled) webview doesn't come back blank.
  const store = useDesktopShellStore.getState();
  store.openRightPanelSection('browser');
  store.setActiveRightBrowserTab(tabId);
  const webview = requireWebview(tabId);
  const image = await webview.capturePage();
  return { mimeType: 'image/png', base64: image.toPNG().toString('base64') };
}

function parseArgs<Schema extends z.ZodType>(schema: Schema, args: unknown): z.infer<Schema> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    throw new CommandError('invalid-args', parsed.error.issues[0]?.message ?? 'invalid args');
  }
  return parsed.data;
}

function assertAllowedUrl(url: string): void {
  if (!isAllowedBrowserUrl(url)) {
    throw new CommandError('not-allowed', 'only http(s) URLs can be opened in the browser');
  }
}

function toCommandError(err: unknown): BrowserCommandError {
  if (err instanceof CommandError) {
    return { code: err.code, message: err.message, retryable: err.retryable };
  }
  return {
    code: 'execution-failed',
    message: extractErrorMessage(err) ?? 'Unknown executor error',
    retryable: false,
  };
}

function refSelector(ref: string): string {
  return `[${REF_ATTRIBUTE}=${JSON.stringify(ref)}]`;
}

/** Resolves `true` when the ref still exists (false → stale), throwing nothing page-side. */
function clickScript(ref: string): string {
  return `(() => {
  const el = document.querySelector(${JSON.stringify(refSelector(ref))});
  if (!el) return false;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.click();
  return true;
})()`;
}

function typeScript(ref: string, text: string): string {
  return `(() => {
  const el = document.querySelector(${JSON.stringify(refSelector(ref))});
  if (!el) return false;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.focus();
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    const proto = tag === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.textContent = ${JSON.stringify(text)};
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  return true;
})()`;
}
