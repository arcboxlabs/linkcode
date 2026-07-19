import { noop } from 'foxts/noop';
import { describe, expect, it, vi } from 'vitest';
import { createSessionPtyTransport } from '../live-terminal';
import type { TerminalSession } from '../session';

function createSession(subscribe: TerminalSession['subscribe']): TerminalSession {
  return {
    initialSize: () => null,
    subscribe,
    canControl: () => false,
    subscribeController: () => noop,
    replayWasTruncated: () => false,
    subscribeReplayTruncated: () => noop,
    sendInput: noop,
    resize: noop,
  };
}

describe('createSessionPtyTransport', () => {
  it('does not reconnect after an exit delivered synchronously during subscribe', () => {
    const unsubscribe = vi.fn();
    const session = createSession((_onEvent, onExit) => {
      onExit?.(7);
      return unsubscribe;
    });
    const transport = createSessionPtyTransport(session, noop);
    const onConnect = vi.fn();
    const onExit = vi.fn();

    transport.connect({ url: 'session://terminal', callbacks: { onConnect, onExit } });

    expect(onExit).toHaveBeenCalledWith(7);
    expect(onConnect).not.toHaveBeenCalled();
    expect(transport.isConnected()).toBe(false);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('prevents a secondary view from sending input or resize', () => {
    const sendInput = vi.fn();
    const resize = vi.fn();
    const session = {
      ...createSession(() => noop),
      canControl: () => true,
      sendInput,
      resize,
    };
    const transport = createSessionPtyTransport(session, noop, false);

    transport.sendInput('echo secondary');
    transport.resize(120, 40);

    expect(sendInput).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
  });
});
