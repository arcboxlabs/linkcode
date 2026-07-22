/**
 * Host-side iOS Simulator boundary (interface-first, docs/ARCHITECTURE.md#core-principles): the
 * daemon injects `@linkcode/sim`'s client, which satisfies this port structurally — neither
 * package imports the other, mirroring the PTY seam. Shapes and error codes follow
 * `crates/linkcode-sim/PROTOCOL.md`; rejections may carry a string `code` (e.g. `xcodeMissing`,
 * on which the daemon gates the whole capability).
 */

/** One available simulator device. */
export interface SimulatorDeviceInfo {
  udid: string;
  name: string;
  /** CoreSimulator state string: `Shutdown`, `Booted`, `Booting`, … */
  state: string;
  /** Runtime identifier, e.g. `com.apple.CoreSimulator.SimRuntime.iOS-26-5`. */
  runtime: string;
  /** Human-readable runtime name (`iOS 26.5`); absent when unknown. */
  runtimeName?: string;
  deviceType: string | null;
}

/** Where the host's simulator tooling lives; resolving it proves the capability exists. */
export interface SimulatorProbe {
  simctlPath: string;
  developerDir: string;
}

export type SimulatorImageFormat = 'jpeg' | 'png';

/** A hardware button the private HID layer can press. */
export type SimulatorButton = 'home' | 'lock';

/** A normalized (0..1) point on the device screen. */
export interface SimulatorPoint {
  x: number;
  y: number;
}

/** Framebuffer stream tuning; omitted fields take the sidecar defaults. */
export interface SimulatorStreamOptions {
  fps?: number;
  quality?: number;
  /** Downscale factor before encode (0..1; 1.0 = native). Lower trades resolution for rate/bandwidth. */
  scale?: number;
}

/** `streamStart` outcome: the accepted stream, or a no-op when one is already running. */
export type SimulatorStreamStartResult =
  | { streaming: true; fps: number; scale: number }
  | { alreadyStreaming: true };

/** A live framebuffer frame: JPEG bytes for one device. */
export type SimulatorFrameListener = (image: Uint8Array) => void;

export interface SimulatorBackend {
  probe(): Promise<SimulatorProbe>;
  list(): Promise<SimulatorDeviceInfo[]>;
  /** Boot and wait until the device is fully usable; an already-booted device succeeds. */
  boot(udid: string): Promise<void>;
  /** Shut a device down; an already-shutdown device succeeds. */
  shutdownDevice(udid: string): Promise<void>;
  install(udid: string, appPath: string): Promise<void>;
  launch(udid: string, bundleId: string): Promise<number | null>;
  terminate(udid: string, bundleId: string): Promise<void>;
  openUrl(udid: string, url: string): Promise<void>;
  screenshot(udid: string, format?: SimulatorImageFormat): Promise<Uint8Array>;
  /** Tap at a normalized (0..1) point (private HID; macOS only). */
  tap(udid: string, x: number, y: number): Promise<void>;
  /** Swipe between two normalized (0..1) points over `durationMs` (private HID; macOS only). */
  swipe(udid: string, from: SimulatorPoint, to: SimulatorPoint, durationMs?: number): Promise<void>;
  /** Press a hardware button (private HID; macOS only). */
  button(udid: string, button: SimulatorButton): Promise<void>;
  /** Start streaming `udid`'s framebuffer; frames arrive via {@link onFrame} listeners. */
  streamStart(udid: string, options?: SimulatorStreamOptions): Promise<SimulatorStreamStartResult>;
  /** Stop a running framebuffer stream. */
  streamStop(udid: string): Promise<void>;
  /** Subscribe to `udid`'s framebuffer frames; returns an unsubscribe function. */
  onFrame(udid: string, listener: SimulatorFrameListener): () => void;
  /** Release the backend process (engine shutdown). Booted devices keep running host-side. */
  close(): void;
}
