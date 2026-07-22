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
  /** Release the backend process (engine shutdown). Booted devices keep running host-side. */
  close(): void;
}
