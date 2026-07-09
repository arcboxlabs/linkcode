import { describe, expect, it, vi } from 'vitest';
import type { AgentLoginCallbacks, LoginChildProcess } from '../login';
import { parseClaudeLoginUrl, startClaudeLogin } from '../login';

const REAL_URL =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=xyz';

describe('parseClaudeLoginUrl', () => {
  it('extracts the authorize URL from the CLI prompt', () => {
    expect(
      parseClaudeLoginUrl(`If the browser didn't open, visit: ${REAL_URL}\nPaste code >`),
    ).toBe(REAL_URL);
  });

  it('returns undefined when no authorize URL is present', () => {
    expect(parseClaudeLoginUrl('Opening browser to sign in…')).toBeUndefined();
  });

  it('does not match the URL-encoded redirect_uri on its own', () => {
    expect(
      parseClaudeLoginUrl('redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode'),
    ).toBeUndefined();
  });
});

/** A controllable stand-in for the spawned child; drives the login state machine from a test. */
function makeFakeChild() {
  const stdoutListeners: Array<(chunk: unknown) => void> = [];
  const exitListeners: Array<(code: number | null) => void> = [];
  const errorListeners: Array<(err: Error) => void> = [];
  const writes: string[] = [];
  let killed = false;
  const child: LoginChildProcess = {
    stdout: { on: (_event, listener) => stdoutListeners.push(listener) },
    stderr: {
      on() {
        /* stderr not exercised in these tests */
      },
    },
    stdin: { write: (data) => writes.push(data) },
    on(event, listener) {
      if (event === 'exit') exitListeners.push(listener as (code: number | null) => void);
      else errorListeners.push(listener as (err: Error) => void);
    },
    kill() {
      killed = true;
    },
  };
  return {
    child,
    emitStdout: (chunk: string) => stdoutListeners.forEach((l) => l(chunk)),
    emitExit: (code: number | null) => exitListeners.forEach((l) => l(code)),
    emitError: (err: Error) => errorListeners.forEach((l) => l(err)),
    writes,
    isKilled: () => killed,
  };
}

function startWithFake(callbacks: Partial<AgentLoginCallbacks> = {}) {
  const fake = makeFakeChild();
  const onUrl = vi.fn(callbacks.onUrl);
  const onSettled = vi.fn(callbacks.onSettled);
  const handle = startClaudeLogin('/bin/claude', { onUrl, onSettled }, () => fake.child);
  return { fake, onUrl, onSettled, handle };
}

describe('startClaudeLogin', () => {
  it('emits the authorize URL once, even across chunk boundaries', () => {
    const { fake, onUrl } = startWithFake();
    fake.emitStdout('visit: https://claude.com/cai/oauth/aut');
    expect(onUrl).not.toHaveBeenCalled();
    fake.emitStdout('horize?code=true&state=xyz\n');
    fake.emitStdout('https://claude.com/cai/oauth/authorize?code=true&state=other\n');
    expect(onUrl).toHaveBeenCalledExactlyOnceWith(
      'https://claude.com/cai/oauth/authorize?code=true&state=xyz',
    );
  });

  it('writes the pasted code to stdin with a trailing newline', () => {
    const { fake, handle } = startWithFake();
    handle.submitCode('  my-code  ');
    expect(fake.writes).toEqual(['my-code\n']);
  });

  it('settles ok on a clean exit', () => {
    const { fake, onSettled } = startWithFake();
    fake.emitExit(0);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith({ ok: true });
  });

  it('settles with the captured error on a non-zero exit', () => {
    const { fake, onSettled } = startWithFake();
    fake.emitExit(1);
    expect(onSettled).toHaveBeenCalledExactlyOnceWith({
      ok: false,
      error: 'login exited with code 1',
    });
  });

  it('kills the child on cancel', () => {
    const { fake, handle } = startWithFake();
    handle.cancel();
    expect(fake.isKilled()).toBe(true);
  });
});
