import type { Unsubscribe } from '@linkcode/transport';

/**
 * Host-side PTY boundary (interface-first, docs/ARCHITECTURE.md#core-principles). The daemon injects a concrete implementation
 * (a Rust sidecar); the engine itself carries no native PTY dependency and stays testable against a
 * fake backend. This is the only seam where terminal I/O touches the OS — everything above it (the
 * `TerminalService`, the wire contract) is platform-agnostic.
 */

/** Parameters for spawning a PTY-backed terminal. */
export interface PtyOpenOptions {
  cols: number;
  rows: number;
  /** Working directory; defaults to the host process's cwd when unset. */
  cwd?: string;
  /** Shell/command to run; defaults to the host's login shell when unset. */
  shell?: string;
  /** Arguments for `shell` (engine-internal — the wire's terminal.open does not expose them). */
  args?: string[];
  /** Extra environment merged over the inherited one (engine-internal, e.g. the script env contract). */
  env?: Record<string, string>;
}

/**
 * A live PTY. Data crosses this boundary as UTF-8 strings — the backend owns the streaming byte→string
 * decode so the rest of the engine (and the JSON wire) never handle raw bytes or base64.
 */
export interface PtyProcess {
  onData(cb: (data: string) => void): Unsubscribe;
  /** `exitCode` is null when the shell was terminated by a signal rather than exiting with a code. */
  onExit(cb: (exitCode: number | null) => void): Unsubscribe;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface PtyBackend {
  open(terminalId: string, opts: PtyOpenOptions): Promise<PtyProcess>;
  /** Release the backend and every terminal it owns (engine shutdown). */
  shutdown(): void;
}
