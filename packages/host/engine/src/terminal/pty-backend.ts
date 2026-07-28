import type { Unsubscribe } from '@linkcode/transport';

/**
 * Host-side PTY boundary (interface-first, docs/ARCHITECTURE.md#core-principles): the daemon
 * injects the concrete implementation (a Rust sidecar), keeping the engine free of native PTY
 * dependencies. This is the only seam where terminal I/O touches the OS.
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
  /** Initial PTY read-credit budget in bytes; unset spawns an unthrottled terminal. */
  credit?: number;
}

/** A live PTY. Data crosses this boundary as UTF-8 strings — the backend owns the streaming
 * byte→string decode, so the rest of the engine (and the JSON wire) never handles raw bytes. */
export interface PtyProcess {
  /** The first subscriber receives any output that arrived between spawn and `open()` resolving. */
  onData(cb: (data: string) => void): Unsubscribe;
  /** The first subscriber observes a pre-resolve exit; null means termination by signal. */
  onExit(cb: (exitCode: number | null) => void): Unsubscribe;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Grant additional read budget to a terminal opened with `credit` (no-op otherwise). A backend
   * with no flow control may implement this as a no-op; output then flows unthrottled. */
  grantRead(bytes: number): void;
  kill(): void;
}

export interface PtyBackend {
  open(terminalId: string, opts: PtyOpenOptions): Promise<PtyProcess>;
  /** Release the backend and every terminal it owns (engine shutdown). */
  shutdown(): void;
}
