import { z } from 'zod';

/**
 * iOS Simulator model shapes shared by the wire and clients. The host-side source of truth is
 * the `linkcode-sim` sidecar (`crates/linkcode-sim/PROTOCOL.md`), reached through the engine's
 * simulator service — device state is CoreSimulator's, not ours.
 */

export const SimulatorDeviceSchema = z.object({
  udid: z.string().min(1),
  name: z.string(),
  /** CoreSimulator state string: `Shutdown`, `Booted`, `Booting`, … */
  state: z.string(),
  /** Runtime identifier, e.g. `com.apple.CoreSimulator.SimRuntime.iOS-26-5`. */
  runtime: z.string(),
  /** Human-readable runtime name (`iOS 26.5`); absent when unknown. */
  runtimeName: z.string().optional(),
  deviceType: z.string().nullable(),
});
export type SimulatorDevice = z.infer<typeof SimulatorDeviceSchema>;

/** Whether this host can drive simulators at all (macOS + Xcode with the iOS platform). */
export const SimulatorStatusSchema = z.object({
  available: z.boolean(),
  /** Where simctl lives; present when available. */
  simctlPath: z.string().optional(),
  developerDir: z.string().optional(),
  /** Whether the host can stream a framebuffer and inject HID input (private SimulatorKit), not
   * just run simctl; present when available. Clients gate the live co-driving panel on it. */
  interactive: z.boolean().optional(),
  /** Why unavailable (e.g. Xcode missing); present when not available. */
  reason: z.string().optional(),
  /** The next thing the user must do before a device can run, so a client can guide them step by
   * step instead of reporting a dead end. Absent once a device exists.
   *
   * `xcode` — no Xcode or its command-line tools; `runtime` — Xcode, but no usable iOS runtime (a
   * bare install ships without one, and an interrupted download leaves an unusable entry);
   * `devices` — a runtime, but every device was deleted. */
  blocker: z.enum(['xcode', 'runtime', 'devices']).optional(),
});
export type SimulatorStatus = z.infer<typeof SimulatorStatusSchema>;

/**
 * Whether an agent may drive a device (CODE-420). Absent = never asked; the first agent tool call
 * on such a device suspends and asks the user. The panel's own manual control is never gated by
 * this — a denied device is still fully usable by hand.
 */
export const SimulatorConsentDecisionSchema = z.enum(['granted', 'denied']);
export type SimulatorConsentDecision = z.infer<typeof SimulatorConsentDecisionSchema>;

export const SimulatorConsentEntrySchema = z.object({
  udid: z.string().min(1),
  decision: SimulatorConsentDecisionSchema,
});
export type SimulatorConsentEntry = z.infer<typeof SimulatorConsentEntrySchema>;

/** Consent state as a whole: the per-device decisions plus the global agent-tools kill switch. */
export const SimulatorConsentStateSchema = z.object({
  entries: z.array(SimulatorConsentEntrySchema),
  /** When false, every simulator MCP tool is refused regardless of per-device consent. */
  agentToolsEnabled: z.boolean(),
});
export type SimulatorConsentState = z.infer<typeof SimulatorConsentStateSchema>;

/**
 * How many simulators one thread may hold at once. Enforced by the engine's claim registry
 * (`limit_exceeded`); clients read it to stop offering a fifth device rather than to re-implement
 * the rule — the host stays the authority either way.
 */
export const MAX_SIMULATORS_PER_SESSION = 4;

/** Hardware buttons the sidecar can press. Home/lock ride the legacy Indigo button message;
 * the volume rockers are consumer-page HID usages (CODE-414). */
export const SimulatorButtonSchema = z.enum(['home', 'lock', 'volumeUp', 'volumeDown']);
export type SimulatorButton = z.infer<typeof SimulatorButtonSchema>;

export const SimulatorImageFormatSchema = z.enum(['jpeg', 'png']);
export type SimulatorImageFormat = z.infer<typeof SimulatorImageFormatSchema>;

/** Framebuffer stream encodings: independently-decodable JPEG frames, or ordered hardware H.264
 * access units (Annex-B, native resolution — decoded client-side with WebCodecs). */
export const SimulatorStreamCodecSchema = z.enum(['jpeg', 'h264']);
export type SimulatorStreamCodec = z.infer<typeof SimulatorStreamCodecSchema>;

/** One phase of a streamed touch gesture (one `down`, moves, one `up` per gesture). */
export const SimulatorTouchPhaseSchema = z.enum(['down', 'move', 'up']);
export type SimulatorTouchPhase = z.infer<typeof SimulatorTouchPhaseSchema>;

/** Interface orientation for a rotate command; the four `UIInterfaceOrientation` cases.
 * `landscapeLeft` puts the home indicator on the left (rotated 90° CCW), `landscapeRight` on the
 * right (90° CW). */
export const SimulatorOrientationSchema = z.enum([
  'portrait',
  'portraitUpsideDown',
  'landscapeLeft',
  'landscapeRight',
]);
export type SimulatorOrientation = z.infer<typeof SimulatorOrientationSchema>;

/** One node of the guest's accessibility tree.
 *
 * `frame` is `[x, y, width, height]` in device points, faithful to what the guest reports;
 * `center` is that frame's centre normalized 0..1, which is the scale every pointer command takes
 * — so a client can act on a node without knowing the device's pixel size. The recursion needs an
 * explicit interface: zod cannot infer a self-referential shape. */
export interface SimulatorAxNode {
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
  children?: SimulatorAxNode[];
}

export const SimulatorAxNodeSchema: z.ZodType<SimulatorAxNode> = z.lazy(() =>
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
    children: z.array(SimulatorAxNodeSchema).optional(),
  }),
);
