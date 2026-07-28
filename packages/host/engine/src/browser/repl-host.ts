import type { Context } from 'node:vm';
import { createContext, Script } from 'node:vm';
import type { BrowserCommandArgs, BrowserCommandResult, BrowserOp } from '@linkcode/schema';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import { rewriteForPersistentRepl } from './repl-rewrite';

/** Bound on the synchronous portion of an execute call (everything up to the first `await`,
 * or the whole script if it never awaits) — enforced by the vm `timeout` option, which can
 * interrupt a `while (true) {}` that would otherwise block the daemon event loop. */
const SYNC_TIMEOUT_MS = 5000;
/** Bound on the whole execute call. Generous enough for several sequential broker ops (each
 * already capped at 15s by the broker), tight enough that a never-settling promise fails the
 * tool call instead of wedging the session. */
const EXECUTE_TIMEOUT_MS = 60000;

export type BrowserOpDispatcher = (
  op: BrowserOp,
  args: BrowserCommandArgs,
) => Promise<BrowserCommandResult>;

export interface BrowserExecuteResult {
  ok: boolean;
  value?: unknown;
  logs: string[];
  error?: string;
}

/** Behavior discipline embedded in the execute tool description (the Codex lesson: the model
 * must read the rules before driving the page). */
export const BROWSER_TOOL_DOCUMENTATION = `Run JavaScript in a persistent REPL that controls the user's in-app browser (you and the user share the same visible tabs). Variables persist across calls. Await every browser.* call. console.log output is returned alongside the completion value.

API (all methods return promises; tab ids come from browser.tabs()):
- browser.tabs() → [{ id, url, title, active }]
- browser.open(url) → open a NEW tab (http/https only) and return the tab list
- browser.select(tabId) / browser.close(tabId)
- browser.navigate(tabId, url) / browser.back(tabId) / browser.reload(tabId)
- browser.snapshot(tabId) → { url, title, nodes: [{ ref, role, name, value? }], truncated } — the interactive elements
- browser.click(tabId, ref) / browser.type(tabId, ref, text) — ref is a "@eN" ref from the LAST snapshot
- browser.screenshot(tabId) → { mimeType, base64 } (also brings the tab forward)
- browser.evaluate(tabId, js) → run JS inside the page and return its JSON-serializable result

Discipline:
1. ALWAYS take browser.snapshot(tabId) before click/type — refs only exist after a snapshot.
2. Refs go stale on ANY navigation (including ones your click caused). On a stale-ref error, re-snapshot and re-resolve the element; never retry a stale ref.
3. After an action that loads a page, snapshot again before the next interaction.
4. Prefer snapshot+refs over evaluate for interaction; use evaluate for reading page data.
5. Errors are thrown with a closed code prefix (e.g. "host-unavailable: …" when the desktop app is not running).
6. Each execute call must settle within 60s (individual browser.* calls within 15s) — keep scripts short and check intermediate results instead of writing one long script.`;

export interface BrowserReplHostOptions {
  syncTimeoutMs?: number;
  executeTimeoutMs?: number;
}

/**
 * Code-mode host (CODE-267, reviving the sky-mcp REPL skeleton): runs model-authored JS in a
 * persistent vm context with only a `browser` namespace and a captured `console` injected.
 * Top-level declarations are rewritten onto the context global (`rewriteForPersistentRepl`),
 * so bindings persist across `execute` calls and the model can bind tab ids once.
 *
 * SECURITY: `node:vm` is NOT a security boundary — model code is semi-trusted, and effects are
 * gated by the execute tool's approval flow plus the default-off feature gate, never here.
 * The timeouts bound runaway code, with one in-process gap: a synchronous infinite loop AFTER
 * an `await` resumes as a microtask outside the vm timeout and still blocks the event loop;
 * closing that needs worker isolation, which the broker topology doesn't justify yet.
 */
export class BrowserReplHost {
  /** Embedded verbatim in the execute tool's description (agent-adapter `BrowserToolset`). */
  readonly documentation = BROWSER_TOOL_DOCUMENTATION;
  private readonly vmContext: Context;
  private readonly logs: string[] = [];
  private readonly syncTimeoutMs: number;
  private readonly executeTimeoutMs: number;

  constructor(dispatch: BrowserOpDispatcher, options?: BrowserReplHostOptions) {
    const capturedConsole = {
      log: (...args: unknown[]): void => {
        this.logs.push(args.map(String).join(' '));
      },
    };
    this.vmContext = createContext({
      browser: buildBrowserNamespace(dispatch),
      console: capturedConsole,
    });
    this.syncTimeoutMs = options?.syncTimeoutMs ?? SYNC_TIMEOUT_MS;
    this.executeTimeoutMs = options?.executeTimeoutMs ?? EXECUTE_TIMEOUT_MS;
  }

  async execute(code: string): Promise<BrowserExecuteResult> {
    this.logs.length = 0;
    let timer: NodeJS.Timeout | undefined;
    try {
      const script = new Script(rewriteForPersistentRepl(code));
      const completion = Promise.resolve(
        script.runInContext(this.vmContext, { timeout: this.syncTimeoutMs }) as unknown,
      );
      // A rejection landing after the race is lost must not become an unhandled rejection.
      completion.catch(noop);
      const expiry = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`timeout: execute did not settle within ${this.executeTimeoutMs}ms`));
        }, this.executeTimeoutMs);
      });
      const value = await Promise.race([completion, expiry]);
      return { ok: true, value, logs: [...this.logs] };
    } catch (error) {
      return {
        ok: false,
        logs: [...this.logs],
        error: extractErrorMessage(error) ?? 'unknown error',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The `browser` object injected into the REPL; each method is one broker op. A failed result
 * becomes a thrown Error carrying the closed code, so model code can catch or surface it. */
function buildBrowserNamespace(dispatch: BrowserOpDispatcher) {
  const call = async (op: BrowserOp, args: BrowserCommandArgs): Promise<unknown> => {
    const result = await dispatch(op, args);
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.data;
  };
  return {
    tabs: () => call('tabs.list', {}),
    open: (url: string) => call('tabs.open', { url }),
    select: (tabId: string) => call('tabs.select', { tabId }),
    navigate: (tabId: string, url: string) => call('tab.navigate', { tabId, url }),
    back: (tabId: string) => call('tab.back', { tabId }),
    reload: (tabId: string) => call('tab.reload', { tabId }),
    close: (tabId: string) => call('tab.close', { tabId }),
    snapshot: (tabId: string) => call('tab.snapshot', { tabId }),
    click: (tabId: string, ref: string) => call('tab.click', { tabId, ref }),
    type: (tabId: string, ref: string, text: string) => call('tab.type', { tabId, ref, text }),
    screenshot: (tabId: string) => call('tab.screenshot', { tabId }),
    evaluate: (tabId: string, js: string) => call('tab.evaluate', { tabId, js }),
  };
}
