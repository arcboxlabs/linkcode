import type { LinkCodeClient } from '@linkcode/client-core';
import type { TerminalSession } from '@linkcode/ui/shell/terminal';

/** The slice of `LinkCodeClient` a live terminal session drives. */
export type TerminalTransportClient = Pick<
  LinkCodeClient,
  'subscribeTerminalOutput' | 'subscribeTerminalExit' | 'terminalInput' | 'resizeTerminal'
>;

/** A `TerminalSession` backed by an open terminal on the daemon, over the `terminal.*` wire messages. */
export function createTransportTerminalSession(
  client: TerminalTransportClient,
  terminalId: string,
): TerminalSession {
  return {
    subscribe(onOutput, onExit) {
      const unsubOutput = client.subscribeTerminalOutput(terminalId, onOutput);
      const unsubExit = onExit ? client.subscribeTerminalExit(terminalId, onExit) : undefined;
      return () => {
        unsubOutput();
        unsubExit?.();
      };
    },
    sendInput(data) {
      client.terminalInput(terminalId, data);
    },
    resize(cols, rows) {
      client.resizeTerminal(terminalId, cols, rows);
    },
  };
}
