import { z } from 'zod';

/**
 * JSON bodies of the sim sidecar's `RESULT` frames, validated once at this boundary
 * (`crates/linkcode-sim/PROTOCOL.md` is the contract). Op-specific `result` payloads are parsed
 * by the client method that issued the request.
 */

/** Stable failure codes the sidecar classifies into (`src/rpc.rs` `ErrorCode`). */
export type SimErrorCode = 'xcodeMissing' | 'simctlFailed' | 'timeout' | 'invalidRequest' | 'io';

export const SimResultSchema = z.discriminatedUnion('ok', [
  z.object({ requestId: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({
    requestId: z.string(),
    ok: z.literal(false),
    // `code` stays an open string so a newer sidecar's codes degrade to opaque errors, not drops.
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);
export type SimResult = z.infer<typeof SimResultSchema>;

export const SimDeviceSchema = z.object({
  udid: z.string(),
  name: z.string(),
  /** CoreSimulator state string: `Shutdown`, `Booted`, `Booting`, … */
  state: z.string(),
  /** Runtime identifier, e.g. `com.apple.CoreSimulator.SimRuntime.iOS-26-5`. */
  runtime: z.string(),
  /** Human-readable runtime name (`iOS 26.5`); absent when the runtime section doesn't list it. */
  runtimeName: z.string().optional(),
  deviceType: z.string().nullable(),
});
export type SimDevice = z.infer<typeof SimDeviceSchema>;

export const SimListResultSchema = z.object({ devices: z.array(SimDeviceSchema) });

export const SimProbeSchema = z.object({
  simctlPath: z.string(),
  developerDir: z.string(),
  /** Whether the private SimulatorKit layer (framebuffer stream + HID) is reachable; simctl alone
   * is not enough to co-drive a device. Defaulted so an older sidecar reads as non-interactive. */
  interactive: z.boolean().default(false),
});
export type SimProbe = z.infer<typeof SimProbeSchema>;

export const SimLaunchResultSchema = z.object({ pid: z.number().int().nullable() });

export const SimStreamCodecSchema = z.enum(['jpeg', 'h264']);
export type SimStreamCodec = z.infer<typeof SimStreamCodecSchema>;

/** `streamStart` reply: the accepted stream, or a no-op when one is already running. `codec` is
 * absent from sidecars predating h264 support — those always stream JPEG. */
export const SimStreamStartResultSchema = z.union([
  z.object({
    streaming: z.literal(true),
    fps: z.number().int(),
    scale: z.number(),
    codec: SimStreamCodecSchema.default('jpeg'),
  }),
  z.object({ alreadyStreaming: z.literal(true) }),
]);
export type SimStreamStartResult = z.infer<typeof SimStreamStartResultSchema>;

/** A hardware button the private HID layer can press. */
export type SimButton = 'home' | 'lock';

/** Interface orientation for a rotate command (matches `UIDeviceOrientation`). */
export type SimOrientation = 'portrait' | 'portraitUpsideDown' | 'landscapeLeft' | 'landscapeRight';

/** One phase of a streamed touch gesture (one `down`, moves, one `up` per gesture). */
export type SimTouchPhase = 'down' | 'move' | 'up';

export type SimImageFormat = 'jpeg' | 'png';
