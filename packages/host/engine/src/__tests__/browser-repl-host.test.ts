import { describe, expect, it } from 'vitest';
import { BrowserReplHost } from '../browser/repl-host';

const TIMEOUT_PATTERN = /timed out/i;
const EXECUTE_TIMEOUT_PATTERN = /timeout: execute did not settle within 50ms/;
const HOST_UNAVAILABLE_PATTERN = /host-unavailable: desktop app not running/;
const SYNTAX_ERROR_PATTERN = /SyntaxError|Unexpected/i;

function dispatch(op: string) {
  if (op === 'tabs.list') {
    return Promise.resolve({ ok: true as const, data: [{ id: 't1', url: 'https://a.test' }] });
  }
  return Promise.resolve({
    ok: false as const,
    error: {
      code: 'host-unavailable' as const,
      message: 'desktop app not running',
      retryable: true,
    },
  });
}

describe('BrowserReplHost', () => {
  it('persists const bindings with top-level await across execute calls', async () => {
    const host = new BrowserReplHost(dispatch);

    const first = await host.execute('const tabs = await browser.tabs();\nreturn tabs.length;');
    expect(first).toMatchObject({ ok: true, value: 1 });

    const second = await host.execute('return tabs[0].id;');
    expect(second).toMatchObject({ ok: true, value: 't1' });
  });

  it('persists destructured and uninitialized bindings', async () => {
    const host = new BrowserReplHost(dispatch);

    await host.execute('const [{ id, url }] = await browser.tabs();\nlet note;');
    const result = await host.execute('note = url;\nreturn id + " " + note;');
    expect(result).toMatchObject({ ok: true, value: 't1 https://a.test' });
  });

  it('persists function and class declarations', async () => {
    const host = new BrowserReplHost(dispatch);

    await host.execute(
      'function twice(n) { return n * 2; }\nclass Box { constructor(v) { this.v = v; } }',
    );
    const result = await host.execute('return new Box(twice(21)).v;');
    expect(result).toMatchObject({ ok: true, value: 42 });
  });

  it('interrupts a synchronous infinite loop via the vm timeout', async () => {
    const host = new BrowserReplHost(dispatch, { syncTimeoutMs: 100 });

    const result = await host.execute('while (true) {}');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(TIMEOUT_PATTERN);
  });

  it('fails a never-settling await via the execute timeout', async () => {
    const host = new BrowserReplHost(dispatch, { executeTimeoutMs: 50 });

    const result = await host.execute('await new Promise(() => {});');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(EXECUTE_TIMEOUT_PATTERN);
  });

  it('captures console.log output and surfaces closed-code broker errors', async () => {
    const host = new BrowserReplHost(dispatch);

    const result = await host.execute(
      'console.log("before");\nawait browser.open("https://b.test");',
    );
    expect(result.ok).toBe(false);
    expect(result.logs).toEqual(['before']);
    expect(result.error).toMatch(HOST_UNAVAILABLE_PATTERN);
  });

  it('surfaces syntax errors from unparseable code', async () => {
    const host = new BrowserReplHost(dispatch);

    const result = await host.execute('const = ;');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(SYNTAX_ERROR_PATTERN);
  });
});
