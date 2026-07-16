import type { LinkCodeClient } from '@linkcode/client-core';
import type { TerminalSession } from '@linkcode/ui/shell/terminal';

/** The slice of `LinkCodeClient` a live terminal session drives. */
export type TerminalTransportClient = Pick<
  LinkCodeClient,
  | 'subscribeTerminalEvents'
  | 'subscribeTerminalExit'
  | 'subscribeTerminalController'
  | 'subscribeTerminalReplayTruncated'
  | 'terminalCanControl'
  | 'terminalReplayWasTruncated'
  | 'terminalInput'
  | 'resizeTerminal'
>;

/** A `TerminalSession` backed by an open terminal on the daemon, over the `terminal.*` wire messages. */
export function createTransportTerminalSession(
  client: TerminalTransportClient,
  terminalId: string,
  initialSize: { cols: number; rows: number } | null = null,
): TerminalSession {
  return {
    initialSize() {
      return initialSize;
    },
    subscribe(onEvent, onExit) {
      const unsubEvents = client.subscribeTerminalEvents(terminalId, onEvent);
      const unsubExit = onExit ? client.subscribeTerminalExit(terminalId, onExit) : undefined;
      return () => {
        unsubEvents();
        unsubExit?.();
      };
    },
    canControl() {
      return client.terminalCanControl(terminalId);
    },
    subscribeController(onChange) {
      return client.subscribeTerminalController(terminalId, onChange);
    },
    replayWasTruncated() {
      return client.terminalReplayWasTruncated(terminalId);
    },
    subscribeReplayTruncated(onChange) {
      return client.subscribeTerminalReplayTruncated(terminalId, onChange);
    },
    sendInput(data) {
      client.terminalInput(terminalId, data);
    },
    resize(cols, rows) {
      client.resizeTerminal(terminalId, cols, rows);
    },
  };
}
