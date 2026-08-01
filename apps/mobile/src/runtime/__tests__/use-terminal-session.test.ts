// @vitest-environment jsdom

import type { LinkCodeClient } from '@linkcode/client-core';
import { LinkCodeProvider } from '@linkcode/client-core';
import type { TerminalId, TerminalMetadata, TerminalReplayEvent } from '@linkcode/schema';
import type { TerminalRendererRef } from '@mobile/runtime/use-terminal-session';
import { useTerminalSession } from '@mobile/runtime/use-terminal-session';
import { act, renderHook, waitFor } from '@testing-library/react';
import { noop } from 'foxts/noop';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubClient } from './stub-client';

const TERMINAL_ID = 'term-1' as TerminalId;

const TERMINAL: TerminalMetadata = {
  terminalId: TERMINAL_ID,
  cols: 80,
  rows: 24,
  cwd: '/tmp',
  managed: false,
  createdAt: 0,
  controllerAttachmentId: null,
};

/** Emits nothing; the hook only needs the unsubscribe back. */
const silent = vi.fn(() => noop);

const attachTerminal = vi.fn<LinkCodeClient['attachTerminal']>();
const detachTerminal = vi.fn<LinkCodeClient['detachTerminal']>();
const subscribeTerminalEvents = vi.fn<LinkCodeClient['subscribeTerminalEvents']>();

const client = stubClient({
  attachTerminal,
  detachTerminal,
  subscribeTerminalEvents,
  subscribeTerminalController: silent,
  subscribeTerminalExit: silent,
  subscribeTerminalError: silent,
  subscribeTerminalReplayTruncated: silent,
  terminalCanControl: () => true,
});

function render(autoTakeControl = false) {
  return renderHook(() => useTerminalSession(TERMINAL_ID, autoTakeControl), {
    wrapper: ({ children }) => createElement(LinkCodeProvider, { client }, children),
  });
}

function write(seq: number, data: string): TerminalReplayEvent {
  return { type: 'write', seq, data };
}

beforeEach(() => {
  vi.resetAllMocks();
  silent.mockImplementation(() => noop);
  subscribeTerminalEvents.mockImplementation(() => noop);
  attachTerminal.mockResolvedValue({ terminal: TERMINAL, truncated: false });
});

describe('useTerminalSession', () => {
  it('surfaces a failed attach instead of leaving the screen spinning', async () => {
    attachTerminal.mockRejectedValue(new Error('no such terminal'));
    const { result } = render();

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toBe('no such terminal');
  });

  it('batches the events replayed while subscribing into one renderer call', async () => {
    // The daemon's backlog arrives synchronously inside `subscribe`; delivering it event by event
    // would repaint the grid once per line.
    subscribeTerminalEvents.mockImplementation((_id, cb) => {
      cb(write(1, 'one'));
      cb(write(2, 'two'));
      return noop;
    });
    const { result } = render();
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    const renderer: TerminalRendererRef = { events: vi.fn(), exit: vi.fn() };
    act(() => {
      result.current.setRenderer(renderer);
      result.current.onRendererReady();
    });

    await waitFor(() => {
      expect(renderer.events).toHaveBeenCalledTimes(1);
    });
    expect(renderer.events).toHaveBeenCalledWith([write(1, 'one'), write(2, 'two')]);
  });

  it('detaches the terminal when the screen goes away', async () => {
    const unsubscribe = vi.fn();
    silent.mockImplementation(() => unsubscribe);
    const { result, unmount } = render();
    await waitFor(() => {
      expect(result.current.status).toBe('ready');
    });

    unmount();

    expect(detachTerminal).toHaveBeenCalledWith(TERMINAL_ID);
    // One per subscription the hook opened: controller, exit, error, replay-truncated.
    expect(unsubscribe).toHaveBeenCalledTimes(4);
  });
});
