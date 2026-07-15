import type { AgentEvent, StartOptions } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { AUTH_FAILED_ERROR_CODE } from '../adapter';
import { CodexAdapter } from '../native/codex';
import type { CodexServerHandle } from '../native/codex/adapter';
import type { CodexAppServerOptions } from '../native/codex/app-server';

/** Same fake as codex-shell.test.ts: request log + notification/exit callbacks, plus a `closed`
 * flag so tests can assert the auth retirement reaped the process. */
class FakeCodexServer {
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  closed = false;
  constructor(private readonly opts: Omit<CodexAppServerOptions, 'binaryPath'>) {}
  request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params: params as Record<string, unknown> });
    if (method === 'thread/start' || method === 'thread/resume') {
      return Promise.resolve({ thread: { id: 'thread-1' } });
    }
    return Promise.resolve({});
  }
  setRequestHandler(): void {
    // Approvals never fire on these paths.
  }
  close(): void {
    this.closed = true;
  }
  notify(method: string, params: unknown): void {
    this.opts.onNotification(method, params);
  }
}

class TestCodex extends CodexAdapter {
  fakeServers: FakeCodexServer[] = [];
  protected override startAppServer(
    opts: Omit<CodexAppServerOptions, 'binaryPath'>,
  ): Promise<CodexServerHandle> {
    const server = new FakeCodexServer(opts);
    this.fakeServers.push(server);
    return Promise.resolve(server);
  }
  protected override readConfiguredSandbox() {
    return Promise.resolve(undefined);
  }
}

const start: StartOptions = { kind: 'codex', cwd: '/repo' };

/** The mid-retry 401 notification the app-server pushes while reconnecting (verified live). */
const RETRY_401 = {
  error: {
    message: 'Reconnecting... 2/5',
    codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 401 } },
    additionalDetails: 'unexpected status 401 Unauthorized: Missing bearer …',
    willRetry: true,
  },
};

async function promptedAdapter() {
  const adapter = new TestCodex();
  const events: AgentEvent[] = [];
  adapter.onEvent((e) => events.push(e));
  await adapter.start(start);
  await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hi' }] });
  const server = adapter.fakeServers[0];
  server.notify('turn/started', { turn: { id: 'turn-1' } });
  events.length = 0; // Keep only what the failure produces.
  return { adapter, events, server };
}

function errorEvents(events: AgentEvent[]) {
  return events.filter((e): e is Extract<AgentEvent, { type: 'error' }> => e.type === 'error');
}

describe('CodexAdapter auth failure (CODE-174)', () => {
  it('maps the first 401 retry notification to one non-recoverable authentication_failed error', async () => {
    const { events, server } = await promptedAdapter();
    server.notify('error', RETRY_401);
    server.notify('error', {
      ...RETRY_401,
      error: { ...RETRY_401.error, message: 'Reconnecting... 3/5' },
    });
    server.notify('error', {
      ...RETRY_401,
      error: { ...RETRY_401.error, message: 'Reconnecting... 4/5' },
    });

    const errors = errorEvents(events);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe(AUTH_FAILED_ERROR_CODE);
    expect(errors[0].recoverable).toBe(false);
    // The turn settles idle without waiting out the ~27s retry storm.
    expect(events.at(-1)).toEqual({ type: 'status', status: 'idle' });
    expect(server.closed).toBe(true);
  });

  it('matches the final no-retry error whose 401 survives only in prose', async () => {
    const { events, server } = await promptedAdapter();
    server.notify('error', {
      error: {
        message:
          'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header',
        codexErrorInfo: 'other',
        additionalDetails: null,
      },
      willRetry: false,
    });
    const errors = errorEvents(events);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe(AUTH_FAILED_ERROR_CODE);
  });

  it('swallows a buffered failed settle arriving after the retirement', async () => {
    const { events, server } = await promptedAdapter();
    server.notify('error', RETRY_401);
    server.notify('turn/completed', {
      turn: { id: 'turn-1', status: 'failed', error: { message: 'unexpected status 401 …' } },
    });
    expect(errorEvents(events)).toHaveLength(1);
  });

  it('respawns with thread/resume on the next prompt, so a completed login is picked up', async () => {
    const { adapter, server } = await promptedAdapter();
    server.notify('error', RETRY_401);

    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'retry' }] });
    expect(adapter.fakeServers).toHaveLength(2);
    const resumed = adapter.fakeServers[1].requests.find((r) => r.method === 'thread/resume');
    expect(resumed?.params.threadId).toBe('thread-1');
    // The fresh process re-read auth.json — a second 401 must report again, not stay latched.
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    adapter.fakeServers[1].notify('turn/started', { turn: { id: 'turn-2' } });
    adapter.fakeServers[1].notify('error', RETRY_401);
    expect(errorEvents(events)).toHaveLength(1);
  });

  it('keeps plain error notifications as uncoded banners', async () => {
    const { events, server } = await promptedAdapter();
    server.notify('error', {
      error: {
        message: 'Reconnecting... 2/5',
        codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 503 } },
      },
    });
    const errors = errorEvents(events);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBeUndefined();
    expect(server.closed).toBe(false);
  });
});
