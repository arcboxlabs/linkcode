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

/** One node of the guest's accessibility tree.
 *
 * `frame` is in device points, faithful to what the guest reports; `center` is the same point
 * normalized 0..1 against the screen, which is the scale every pointer command takes — so a caller
 * can act on a node without knowing the device's size. The recursion is typed by hand because zod
 * cannot infer a self-referential shape. */
export interface SimAxNode {
  role: string;
  subrole?: string;
  label?: string;
  value?: string;
  identifier?: string;
  title?: string;
  frame: [number, number, number, number];
  center?: [number, number];
  enabled: boolean;
  focused?: boolean;
  children?: SimAxNode[];
}

export const SimAxNodeSchema: z.ZodType<SimAxNode> = z.lazy(() =>
  z.object({
    role: z.string(),
    subrole: z.string().optional(),
    label: z.string().optional(),
    value: z.string().optional(),
    identifier: z.string().optional(),
    title: z.string().optional(),
    frame: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    center: z.tuple([z.number(), z.number()]).optional(),
    enabled: z.boolean(),
    focused: z.boolean().optional(),
    children: z.array(SimAxNodeSchema).optional(),
  }),
);

export const SimDescribeUiResultSchema = z.object({ tree: SimAxNodeSchema });

/** Caps on a tree read. Omitted fields fall back to the sidecar's own defaults. */
export interface SimAxLimits {
  maxDepth?: number;
  maxNodes?: number;
}

export const SimProbeSchema = z.object({
  simctlPath: z.string(),
  developerDir: z.string(),
  /** Whether the private SimulatorKit layer (framebuffer stream + HID) is reachable; simctl alone
   * is not enough to co-drive a device. Defaulted so an older sidecar reads as non-interactive. */
  interactive: z.boolean().default(false),
  /** What still stands between this host and a runnable device; absent once one exists. */
  blocker: z.enum(['runtime', 'devices']).nullish(),
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
