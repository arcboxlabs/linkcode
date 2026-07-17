import type { TerminalReplayEvent } from '@linkcode/schema';

/**
 * The seam between `<LiveTerminal>` (pure restty rendering) and its data source. The component knows
 * only this interface, so a daemon-backed source or a mock can be supplied by the owning runtime.
 */
export interface TerminalSession {
  /** Initial authoritative grid for a viewer attaching before any resize event exists. */
  initialSize(): { cols: number; rows: number } | null;
  /** Replay then stream ordered host writes/resizes; `onExit` fires once when the shell ends. */
  subscribe(
    onEvent: (event: TerminalReplayEvent) => void,
    onExit?: (exitCode: number | null) => void,
  ): () => void;
  /** Read dynamically; controller changes must not require remounting the renderer. */
  canControl(): boolean;
  /** Observe controller changes so the renderer can resync its current viewport on takeover. */
  subscribeController(onChange: (canControl: boolean) => void): () => void;
  /** Whether the bounded replay journal has dropped earlier terminal history. */
  replayWasTruncated(): boolean;
  subscribeReplayTruncated(onChange: () => void): () => void;
  sendInput(data: string): void;
  resize(cols: number, rows: number): void;
}
