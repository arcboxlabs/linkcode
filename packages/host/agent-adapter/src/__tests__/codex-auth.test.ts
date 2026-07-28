import type { AgentEvent, StartOptions } from '@linkcode/schema';
import { describe, expect, it, vi } from 'vitest';
import { AUTH_FAILED_ERROR_CODE } from '../adapter';
import { CodexAdapter } from '../native/codex';
import type { CodexServerHandle } from '../native/codex/adapter';
import type { CodexAppServerOptions } from '../native/codex/app-server';

/** Same fake as codex-shell.test.ts plus the real close() semantics the races depend on: a
 * `closed` flag, close() rejecting held-open requests (failAllPending), and a `holdMethod` knob
 * that keeps one method's request pending so a 401 can land mid-flight. */
class FakeCodexServer {
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  closed = false;
  /** Requests to this method stay pending until close() rejects them, like the real server. */
  holdMethod: string | undefined;
  private readonly held: Array<(reason: Error) => void> = [];
  constructor(private readonly opts: Omit<CodexAppServerOptions, 'binaryPath'>) {}
  request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params: params as Record<string, unknown> });
    if (this.closed) return Promise.reject(new Error('codex: app-server connection is closed'));
    if (method === this.holdMethod) {
      return new Promise((_resolve, reject) => {
        this.held.push(reject);
      });
    }
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
    const rejections = this.held.splice(0);
    for (const reject of rejections) {
      reject(new Error('codex: app-server connection is closed'));
    }
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

  it('drops stale post-retirement notifications entirely (generation gate)', async () => {
    const { events, server } = await promptedAdapter();
    server.notify('error', RETRY_401);
    const settled = events.length;
    // Buffered stdout from the killed child: its failed settle must not re-error or re-idle.
    server.notify('turn/completed', {
      turn: { id: 'turn-1', status: 'failed', error: { message: 'unexpected status 401 …' } },
    });
    server.notify('error', RETRY_401);
    expect(events.length).toBe(settled);
  });

  it('a 401 while turn/start is still in flight settles once, not twice', async () => {
    const adapter = new TestCodex();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start(start);
    const server = adapter.fakeServers[0];
    server.holdMethod = 'turn/start';
    events.length = 0;

    const sendPromise = adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'hi' }] });
    await vi.waitFor(() => {
      expect(server.requests.some((r) => r.method === 'turn/start')).toBe(true);
    });
    server.notify('error', RETRY_401); // close() rejects the held turn/start
    await sendPromise;

    expect(errorEvents(events)).toHaveLength(1);
    expect(events.filter((e) => e.type === 'status' && e.status === 'idle')).toHaveLength(1);
  });

  it('a shell command racing the retirement rejects with the auth story, without a second idle', async () => {
    const adapter = new TestCodex();
    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.start(start);
    const server = adapter.fakeServers[0];
    server.holdMethod = 'thread/shellCommand';
    events.length = 0;

    const sendPromise = adapter.send({ type: 'shell-command', command: 'ls' });
    await vi.waitFor(() => {
      expect(server.requests.some((r) => r.method === 'thread/shellCommand')).toBe(true);
    });
    server.notify('error', RETRY_401);
    await expect(sendPromise).rejects.toThrow('Codex authentication failed');
    expect(errorEvents(events)).toHaveLength(1);
    expect(events.filter((e) => e.type === 'status' && e.status === 'idle')).toHaveLength(1);
  });

  it('surfaces prompts still queued behind the failed turn instead of dropping them silently', async () => {
    const { adapter, events, server } = await promptedAdapter();
    // The active turn makes this prompt queue rather than start.
    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'queued' }] });
    server.notify('error', RETRY_401);

    const errors = errorEvents(events);
    expect(errors).toHaveLength(2);
    expect(errors[0].code).toBe(AUTH_FAILED_ERROR_CODE);
    expect(errors[1].message).toContain('1 queued prompt(s) did not run');
  });

  it('a retired server cannot disturb its respawned successor', async () => {
    const { adapter, server } = await promptedAdapter();
    server.notify('error', RETRY_401);
    await adapter.send({ type: 'prompt', content: [{ type: 'text', text: 'retry' }] });

    const events: AgentEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    server.notify('turn/completed', { turn: { id: 'turn-9', status: 'completed' } });
    server.notify('error', RETRY_401);
    expect(events).toEqual([]);
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
