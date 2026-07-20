/** @vitest-environment jsdom */

import type { TerminalAttachResult } from '@linkcode/client-core';
import { act, render } from '@testing-library/react';
import { noop } from 'foxts/noop';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachedTerminalPanel } from '../attached-panel';

const mocks = vi.hoisted<{ client: Record<string, unknown> }>(() => ({ client: {} }));
const closeTab = vi.hoisted(() => vi.fn());

function selectTerminalPrefs(select: (state: Record<string, unknown>) => unknown): unknown {
  return select({ fontFamily: 'monospace', fontSize: 13, colorScheme: 'dark' });
}

function translate(key: string): string {
  return key;
}

vi.mock('@linkcode/client-core', () => ({
  useLinkCodeClient: () => mocks.client,
}));

vi.mock('@linkcode/ui/shell/terminal', () => ({
  LiveTerminal: () => null,
}));

vi.mock('../../settings/terminal-prefs-store', () => ({
  useTerminalPrefsStore: selectTerminalPrefs,
}));

vi.mock('use-intl', () => ({
  useTranslations: () => translate,
}));

describe('AttachedTerminalPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    closeTab.mockReset();
  });

  it('closes once for a replayed exit and detaches once when the pending attach resolves', async () => {
    let resolveAttach: (result: TerminalAttachResult) => void = noop;
    const detachTerminal = vi.fn();
    const unsubscribeExit = vi.fn();
    mocks.client = {
      attachTerminal: () =>
        new Promise<TerminalAttachResult>((resolve) => {
          resolveAttach = resolve;
        }),
      detachTerminal,
      subscribeTerminalController: () => noop,
      terminalCanControl: () => false,
      subscribeTerminalExit(_terminalId: string, onExit: (code: number | null) => void) {
        onExit(0);
        return unsubscribeExit;
      },
      subscribeTerminalEvents: () => noop,
      subscribeTerminalReplayTruncated: () => noop,
      terminalReplayWasTruncated: () => false,
      terminalInput: noop,
      resizeTerminal: noop,
      takeTerminalControl: () => Promise.resolve(),
    };
    const view = render(<AttachedTerminalPanel terminalId="term-1" onCloseTab={closeTab} />);

    expect(closeTab).toHaveBeenCalledOnce();
    expect(closeTab).toHaveBeenCalledWith('attach:term-1');

    view.unmount();
    expect(detachTerminal).toHaveBeenCalledOnce();
    expect(detachTerminal).toHaveBeenCalledWith('term-1');
    await act(async () => {
      resolveAttach({} as TerminalAttachResult);
      await Promise.resolve();
    });

    expect(detachTerminal).toHaveBeenCalledOnce();
    expect(unsubscribeExit).toHaveBeenCalledOnce();
  });

  it('leaves exit ownership to the primary duplicate surface', () => {
    const subscribeTerminalExit = vi.fn(() => noop);
    mocks.client = {
      subscribeTerminalController: () => noop,
      terminalCanControl: () => false,
      subscribeTerminalExit,
      subscribeTerminalEvents: () => noop,
      subscribeTerminalReplayTruncated: () => noop,
      terminalReplayWasTruncated: () => false,
      terminalInput: noop,
      resizeTerminal: noop,
    };

    const view = render(
      <AttachedTerminalPanel terminalId="term-1" onCloseTab={closeTab} primary={false} />,
    );

    expect(subscribeTerminalExit).not.toHaveBeenCalled();
    expect(closeTab).not.toHaveBeenCalled();
    view.unmount();
  });
});
