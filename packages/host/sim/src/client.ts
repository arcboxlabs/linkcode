import type { ChildProcessByStdio } from 'node:child_process';
import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { extractErrorMessage } from 'foxts/extract-error-message';
import type { Frame } from './codec';
import {
  decodeScreenshotFrame,
  FrameDecoder,
  REQUEST,
  RESULT,
  SCREENSHOT,
  writeFrame,
} from './codec';
import type { SimDevice, SimImageFormat, SimProbe } from './schema';
import {
  SimLaunchResultSchema,
  SimListResultSchema,
  SimProbeSchema,
  SimResultSchema,
} from './schema';

/** The sidecar child: piped stdin/stdout, inherited stderr (its logs go to the host's stderr). */
type SidecarChild = ChildProcessByStdio<Writable, Readable, null>;

/** A sidecar-classified failure; `code` is a `SimErrorCode` for sidecars of this protocol rev. */
export class SimSidecarError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SimSidecarError';
  }
}

interface Pending {
  resolve: (outcome: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Outer reply deadlines per op. The sidecar enforces its own per-op deadlines
 * (`crates/linkcode-sim/src/simctl.rs`) and reports `timeout` errors; these ceilings only catch a
 * sidecar that can't reply at all, so each sits above its sidecar-side counterpart.
 */
const DEFAULT_REPLY_TIMEOUT_MS = 90000;
const REPLY_TIMEOUT_MS: Partial<Record<string, number>> = {
  boot: 210000,
  install: 150000,
};

/**
 * Typed client for the `linkcode-sim` sidecar (contract: `crates/linkcode-sim/PROTOCOL.md`).
 * One long-lived child serves every request; requests run concurrently sidecar-side, so a slow
 * boot never delays a screenshot. Spawned lazily on first use and respawned after a crash.
 *
 * This client is transport, not policy: device↔session ownership, consent, and reclaim live in
 * the engine's simulator service — callers there must not reach around it to this class.
 */
export class SimSidecarClient {
  private child: SidecarChild | null = null;
  private readonly decoder = new FrameDecoder();
  private readonly pending = new Map<string, Pending>();
  private seq = 0;
  private closed = false;

  constructor(private readonly binaryPath: string) {}

  async probe(): Promise<SimProbe> {
    return SimProbeSchema.parse(await this.call('probe', {}));
  }

  async list(): Promise<SimDevice[]> {
    return SimListResultSchema.parse(await this.call('list', {})).devices;
  }

  async boot(udid: string): Promise<void> {
    await this.call('boot', { udid });
  }

  async shutdownDevice(udid: string): Promise<void> {
    await this.call('shutdown', { udid });
  }

  async install(udid: string, appPath: string): Promise<void> {
    await this.call('install', { udid, appPath });
  }

  async launch(udid: string, bundleId: string): Promise<number | null> {
    return SimLaunchResultSchema.parse(await this.call('launch', { udid, bundleId })).pid;
  }

  async terminate(udid: string, bundleId: string): Promise<void> {
    await this.call('terminate', { udid, bundleId });
  }

  async openUrl(udid: string, url: string): Promise<void> {
    await this.call('openUrl', { udid, url });
  }

  async screenshot(udid: string, format: SimImageFormat = 'jpeg'): Promise<Buffer> {
    const image = await this.call('screenshot', { udid, format });
    // The sidecar answers a successful screenshot with a binary frame, never a JSON result.
    if (!Buffer.isBuffer(image)) throw new Error('sim sidecar sent a non-binary screenshot');
    return image;
  }

  /** Release the client and its sidecar. Booted devices keep running server-side. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const child = this.child;
    this.child = null;
    this.decoder.reset();
    this.failAll(new Error('sim client closed'));
    // Close stdin (EOF) rather than kill: the sidecar drains queued replies before exiting.
    child?.stdin.end();
  }

  private call(type: string, params: Record<string, string>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('sim client closed'));
    // Unconfigured binary (see the daemon's `resolveSimSidecarPath`): fail with a clear, stable
    // message instead of `spawn('')`, which would surface as a confusing crash on every call.
    if (!this.binaryPath) {
      return Promise.reject(
        new Error('sim sidecar not configured: simulators are unavailable on this host'),
      );
    }
    const child = this.ensureChild();
    const requestId = `r${++this.seq}`;
    const body = Buffer.from(JSON.stringify({ requestId, op: { type, ...params } }));
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return;
        reject(new Error(`sim sidecar reply timed out: ${type}`));
      }, REPLY_TIMEOUT_MS[type] ?? DEFAULT_REPLY_TIMEOUT_MS);
      // Don't let a pending reply keep the host's event loop alive on its own.
      timer.unref();
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        writeFrame(child.stdin, REQUEST, body);
      } catch (error) {
        // The child died between ensureChild() and the write: fail this request now instead of
        // leaving it registered to wait out the full reply deadline. (Async write failures land on
        // the stdin `error` listener below, which fails every pending request the same way.)
        this.take(requestId);
        reject(new Error(extractErrorMessage(error) ?? 'sim sidecar write failed'));
      }
    });
  }

  private ensureChild(): SidecarChild {
    if (this.child) return this.child;
    // windowsHide: daemon-side children must never pop a console window (root AGENTS invariant);
    // moot for this macOS-only binary, but kept so every spawn site stays uniform.
    const child = spawn(this.binaryPath, [], {
      stdio: ['pipe', 'pipe', 'inherit'],
      windowsHide: true,
    });
    this.child = child;
    // Every listener is scoped to THIS child: after a crash a new request spawns a replacement, and
    // the old child's delayed `exit`/`error`/`data` must not tear down (or feed stale bytes into)
    // the current one. `onChildGone` only fires while `child` is still the live child.
    const teardown = (): void => {
      if (this.child === child) this.onChildGone();
    };
    child.stdout.on('data', (chunk: Buffer) => {
      if (this.child !== child) return;
      try {
        for (const frame of this.decoder.feed(chunk)) this.handleFrame(frame);
      } catch {
        // A corrupt stream cannot be resynchronized mid-flight; drop the child and start over.
        child.kill();
        teardown();
      }
    });
    // A failed spawn (e.g. missing binary) errors the pipes; a broken pipe means the child is
    // gone. Without these listeners the unhandled stream error would crash the host process.
    child.stdin.on('error', teardown);
    child.stdout.on('error', teardown);
    child.on('exit', teardown);
    child.on('error', teardown);
    return child;
  }

  private handleFrame(frame: Frame): void {
    switch (frame.type) {
      case RESULT: {
        const parsed = SimResultSchema.parse(JSON.parse(frame.body.toString('utf8')));
        const waiter = this.take(parsed.requestId);
        if (!waiter) break;
        if (parsed.ok) waiter.resolve(parsed.result);
        else waiter.reject(new SimSidecarError(parsed.error.code, parsed.error.message));
        break;
      }
      case SCREENSHOT: {
        const { requestId, image } = decodeScreenshotFrame(frame.body);
        this.take(requestId)?.resolve(image);
        break;
      }
      default:
        break;
    }
  }

  private take(requestId: string): Pending | undefined {
    const waiter = this.pending.get(requestId);
    if (!waiter) return undefined;
    clearTimeout(waiter.timer);
    this.pending.delete(requestId);
    return waiter;
  }

  private onChildGone(): void {
    this.child = null;
    this.decoder.reset();
    this.failAll(new Error('sim sidecar exited'));
  }

  private failAll(error: Error): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }
}
