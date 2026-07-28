import type { AgentLoginCallbacks, AgentLoginHandle } from '@linkcode/agent-adapter';
import type { WireMessage, WirePayload } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import type { LoginBinaryResolver, StartLogin } from '../agent/login-service';
import { AgentLoginService } from '../agent/login-service';

function recordingTransport(): { transport: Transport; sent: WirePayload[] } {
  const sent: WirePayload[] = [];
  const transport: Transport = {
    connect: () => Promise.resolve(),
    send(msg: WireMessage) {
      sent.push(msg.payload);
    },
    onMessage: () => noop,
    onClose: () => noop,
    close: noop,
  };
  return { transport, sent };
}

/** A `startLogin` seam that captures the callbacks so a test can drive url/settled itself. */
function captureLogin() {
  const captured: { callbacks?: AgentLoginCallbacks; binaryPath?: string; agent?: string } = {};
  const handle: AgentLoginHandle & { submitted: string[]; cancelled: boolean } = {
    submitted: [],
    cancelled: false,
    submitCode(code) {
      this.submitted.push(code);
    },
    cancel() {
      this.cancelled = true;
    },
  };
  const startLogin: StartLogin = (agent, binaryPath, callbacks) => {
    captured.agent = agent;
    captured.binaryPath = binaryPath;
    captured.callbacks = callbacks;
    return handle;
  };
  return { startLogin, handle, captured };
}

function loginId(sent: WirePayload[]): string {
  const started = sent.find((p) => p.kind === 'agent-login.started');
  if (started?.kind !== 'agent-login.started') throw new Error('no agent-login.started');
  return started.loginId;
}

describe('AgentLoginService', () => {
  it('runs the happy path: started → url → settled(ok) → onSuccess, routing code and cancel', () => {
    const { transport, sent } = recordingTransport();
    const onSuccess = vi.fn();
    const { startLogin, handle, captured } = captureLogin();
    const service = new AgentLoginService(transport, () => '/bin/claude', onSuccess, startLogin);

    service.start('req-1', 'claude-code');
    const id = loginId(sent);
    expect(sent).toContainEqual({ kind: 'agent-login.started', replyTo: 'req-1', loginId: id });
    expect(captured.binaryPath).toBe('/bin/claude');

    captured.callbacks?.onUrl('https://claude.com/cai/oauth/authorize?x=1');
    expect(sent).toContainEqual({
      kind: 'agent-login.url',
      loginId: id,
      url: 'https://claude.com/cai/oauth/authorize?x=1',
    });

    service.submitCode(id, 'the-code');
    expect(handle.submitted).toEqual(['the-code']);

    captured.callbacks?.onSettled({ ok: true });
    expect(sent).toContainEqual({ kind: 'agent-login.settled', loginId: id, ok: true });
    expect(onSuccess).toHaveBeenCalledOnce();

    // After settling, the handle is dropped — a late code/cancel is a no-op, not a throw.
    service.submitCode(id, 'late');
    service.cancel(id);
    expect(handle.submitted).toEqual(['the-code']);
    expect(handle.cancelled).toBe(false);
  });

  it('settles with an error and never starts a child for an unsupported agent kind', () => {
    const { transport, sent } = recordingTransport();
    const onSuccess = vi.fn();
    const startLogin = vi.fn<StartLogin>();
    const service = new AgentLoginService(transport, () => '/bin/x', onSuccess, startLogin);

    service.start('req-2', 'pi');
    const id = loginId(sent);
    expect(startLogin).not.toHaveBeenCalled();
    expect(sent).toContainEqual({
      kind: 'agent-login.settled',
      loginId: id,
      ok: false,
      error: 'login is not supported for pi',
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('routes a codex login through the seam with the codex kind and binary', () => {
    const { transport, sent } = recordingTransport();
    const onSuccess = vi.fn();
    const { startLogin, captured } = captureLogin();
    const service = new AgentLoginService(transport, () => '/bin/codex', onSuccess, startLogin);

    service.start('req-5', 'codex');
    const id = loginId(sent);
    expect(captured.agent).toBe('codex');
    expect(captured.binaryPath).toBe('/bin/codex');

    captured.callbacks?.onUrl('https://auth.openai.com/oauth/authorize?x=1');
    expect(sent).toContainEqual({
      kind: 'agent-login.url',
      loginId: id,
      url: 'https://auth.openai.com/oauth/authorize?x=1',
    });
    captured.callbacks?.onSettled({ ok: true });
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('settles unsupported when the seam has no flow for the kind', () => {
    const { transport, sent } = recordingTransport();
    // A bare vi.fn already resolves to undefined — "no flow implemented for this kind".
    const startLogin = vi.fn<StartLogin>();
    const service = new AgentLoginService(transport, () => '/bin/codex', noop, startLogin);

    service.start('req-6', 'codex');
    const id = loginId(sent);
    expect(startLogin).toHaveBeenCalledOnce();
    expect(sent).toContainEqual({
      kind: 'agent-login.settled',
      loginId: id,
      ok: false,
      error: 'login is not supported for codex',
    });
  });

  it('settles with an error when the CLI binary cannot be resolved', () => {
    const { transport, sent } = recordingTransport();
    const startLogin = vi.fn<StartLogin>();
    const resolveNone = vi.fn<LoginBinaryResolver>();
    const service = new AgentLoginService(transport, resolveNone, noop, startLogin);

    service.start('req-3', 'claude-code');
    const id = loginId(sent);
    expect(startLogin).not.toHaveBeenCalled();
    expect(sent).toContainEqual({
      kind: 'agent-login.settled',
      loginId: id,
      ok: false,
      error: 'the claude-code CLI is not available to log in',
    });
  });

  it('does not call onSuccess when a login settles with failure', () => {
    const { transport, sent } = recordingTransport();
    const onSuccess = vi.fn();
    const { startLogin, captured } = captureLogin();
    const service = new AgentLoginService(transport, () => '/bin/claude', onSuccess, startLogin);

    service.start('req-4', 'claude-code');
    captured.callbacks?.onSettled({ ok: false, error: 'boom' });
    const id = loginId(sent);
    expect(sent).toContainEqual({
      kind: 'agent-login.settled',
      loginId: id,
      ok: false,
      error: 'boom',
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
