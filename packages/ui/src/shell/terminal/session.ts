/**
 * The seam between `<LiveTerminal>` (pure restty rendering) and its data source. The component knows
 * only this interface, so a daemon-backed source or a mock can be supplied by the owning runtime.
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
