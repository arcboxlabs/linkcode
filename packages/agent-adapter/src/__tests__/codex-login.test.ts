import { wait } from 'foxts/wait';
import { describe, expect, it, vi } from 'vitest';
import type { CodexAppServerOptions } from '../native/codex/app-server';
import type { CodexLoginServer } from '../native/codex/login';
import { startCodexLogin } from '../native/codex/login';

/** Fake login app-server: records requests, lets tests fire notifications, tracks close(). */
class FakeLoginServer implements CodexLoginServer {
  readonly requests: Array<{ method: string; params: unknown }> = [];
  closed = false;
  startResponse: unknown = {
    type: 'chatgpt',
    loginId: 'login-1',
    authUrl: 'https://auth.openai.com/oauth/authorize?x=1',
  };
  constructor(readonly opts: CodexAppServerOptions) {}
  request(method: string, params: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    return Promise.resolve(this.startResponse);
  }
  close(): void {
    this.closed = true;
  }
}

function harness(startResponse?: unknown) {
  const servers: FakeLoginServer[] = [];
  const urls: string[] = [];
  const settles: Array<{ ok: boolean; error?: string }> = [];
  const startServer = (opts: CodexAppServerOptions): Promise<FakeLoginServer> => {
    const server = new FakeLoginServer(opts);
    if (startResponse !== undefined) server.startResponse = startResponse;
    servers.push(server);
    return Promise.resolve(server);
  };
  const handle = startCodexLogin(
    '/bin/codex',
    { onUrl: (url) => urls.push(url), onSettled: (result) => settles.push(result) },
    startServer,
  );
  return { servers, urls, settles, handle };
}

describe('startCodexLogin', () => {
  it('starts the chatgpt flow and streams the auth URL', async () => {
    const { servers, urls, settles } = harness();
    await wait(0);
    expect(servers[0].requests).toEqual([
      { method: 'account/login/start', params: { type: 'chatgpt' } },
    ]);
    expect(urls).toEqual(['https://auth.openai.com/oauth/authorize?x=1']);
    expect(settles).toEqual([]);
  });

  it('settles ok and reaps the server when account/login/completed succeeds', async () => {
    const { servers, settles } = harness();
    await wait(0);
    servers[0].opts.onNotification('account/login/completed', {
      loginId: 'login-1',
      success: true,
    });
    expect(settles).toEqual([{ ok: true }]);
    expect(servers[0].closed).toBe(true);
  });

  it('settles with the server error when the flow fails', async () => {
    const { servers, settles } = harness();
    await wait(0);
    servers[0].opts.onNotification('account/login/completed', {
      loginId: 'login-1',
      success: false,
      error: 'Login server error: Login was not completed',
    });
    expect(settles).toEqual([{ ok: false, error: 'Login server error: Login was not completed' }]);
  });

  it('settles once: cancel closes the child and later notifications are ignored', async () => {
    const { servers, settles, handle } = harness();
    await wait(0);
    handle.cancel();
    servers[0].opts.onNotification('account/login/completed', {
      loginId: 'login-1',
      success: true,
    });
    expect(settles).toEqual([{ ok: false, error: 'login cancelled' }]);
    expect(servers[0].closed).toBe(true);
  });

  it('cancelling before the server is up still reaps the late child', async () => {
    const servers: FakeLoginServer[] = [];
    const settles: Array<{ ok: boolean; error?: string }> = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handle = startCodexLogin(
      '/bin/codex',
      { onUrl: vi.fn(), onSettled: (result) => settles.push(result) },
      async (opts) => {
        await gate;
        const server = new FakeLoginServer(opts);
        servers.push(server);
        return server;
      },
    );
    handle.cancel();
    release();
    await wait(0);
    expect(settles).toEqual([{ ok: false, error: 'login cancelled' }]);
    expect(servers[0].closed).toBe(true);
    expect(servers[0].requests).toEqual([]);
  });

  it('settles with an error when account/login/start returns no URL', async () => {
    const { settles } = harness({ type: 'chatgpt', loginId: 'login-1' });
    await wait(0);
    expect(settles).toEqual([{ ok: false, error: 'codex did not return a login URL' }]);
  });

  it('settles with the spawn failure when the app-server cannot start', async () => {
    const settles: Array<{ ok: boolean; error?: string }> = [];
    startCodexLogin(
      '/bin/codex',
      { onUrl: vi.fn(), onSettled: (result) => settles.push(result) },
      () => Promise.reject(new Error('codex: CLI binary not found')),
    );
    await wait(0);
    // foxts/extractErrorMessage stringifies with the error name, same as the claude flow.
    expect(settles).toEqual([{ ok: false, error: 'Error: codex: CLI binary not found' }]);
  });

  it('an unexpected exit mid-login settles with the stderr tail', async () => {
    const { servers, settles } = harness();
    await wait(0);
    servers[0].opts.onExit(1, 'boom');
    expect(settles).toEqual([{ ok: false, error: 'boom' }]);
  });
});
