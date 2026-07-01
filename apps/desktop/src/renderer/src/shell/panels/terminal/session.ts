import type { LinkCodeClient } from '@linkcode/client-core';

/**
 * The seam between `<LiveTerminal>` (pure restty rendering) and its data source. The component knows
 * only this interface, so the transport-backed source below can be swapped for a mock in tests.
 */
export interface TerminalSession {
  /** Stream host output; returns an unsubscribe. `onExit` fires once when the shell ends. */
  subscribe(
    onOutput: (data: string) => void,
    onExit?: (exitCode: number | null) => void,
  ): () => void;
  sendInput(data: string): void;
  resize(cols: number, rows: number): void;
}

/** A `TerminalSession` backed by an open terminal on the daemon, over the `terminal.*` wire messages. */
export function createTransportTerminalSession(
  client: LinkCodeClient,
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
