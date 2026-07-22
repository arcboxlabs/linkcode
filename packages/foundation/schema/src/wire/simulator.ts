import { z } from 'zod';
import { SessionIdSchema } from '../model/primitives';
import {
  SimulatorDeviceSchema,
  SimulatorImageFormatSchema,
  SimulatorStatusSchema,
  SimulatorStreamCodecSchema,
  SimulatorTouchPhaseSchema,
} from '../model/simulator';
import { WireRequestIdSchema } from './request';

const udid = z.string().min(1);
/** A normalized screen coordinate, 0..1 from the top-left. */
const coord = z.number().min(0).max(1);
const SimulatorButtonSchema = z.enum(['home', 'lock']);

/**
 * iOS Simulator wire variants. Commands are session-scoped: the engine's simulator service
 * claims the device for `sessionId` (ownership, conflict, and per-session cap rules) before
 * touching it — clients never talk to the sidecar directly. Void commands reply with the generic
 * `request.succeeded`/`request.failed`; `simulator.devices.changed` broadcasts a fresh device
 * list after a state-changing command (boot/shutdown), since the engine has no CoreSimulator
 * watcher. Screenshot bytes ride base64 in JSON for now — the binary channel is a P1 concern.
 */
export const simulatorWireVariants = [
  z.object({ kind: z.literal('simulator.status'), clientReqId: WireRequestIdSchema }),
  z.object({
    kind: z.literal('simulator.status.result'),
    replyTo: WireRequestIdSchema,
    status: SimulatorStatusSchema,
  }),
  z.object({ kind: z.literal('simulator.list'), clientReqId: WireRequestIdSchema }),
  z.object({
    kind: z.literal('simulator.listed'),
    replyTo: WireRequestIdSchema,
    devices: z.array(SimulatorDeviceSchema),
  }),
  z.object({
    kind: z.literal('simulator.devices.changed'),
    devices: z.array(SimulatorDeviceSchema),
  }),
  /** An agent MCP tool call started/settled on a device — the panel's "agent is driving this
   * device" badge. Broadcast, uncorrelated; `udid` is absent for device-less tools (list). */
  z.object({
    kind: z.literal('simulator.activity'),
    sessionId: SessionIdSchema,
    udid: z.string().min(1).optional(),
    tool: z.string(),
    phase: z.enum(['started', 'settled']),
  }),
  z.object({
    kind: z.literal('simulator.boot'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
  }),
  z.object({
    kind: z.literal('simulator.shutdown'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
  }),
  z.object({
    kind: z.literal('simulator.install'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
    appPath: z.string().min(1),
  }),
  z.object({
    kind: z.literal('simulator.launch'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
    bundleId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('simulator.launched'),
    replyTo: WireRequestIdSchema,
    pid: z.number().int().nullable(),
  }),
  z.object({
    kind: z.literal('simulator.terminate'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
    bundleId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('simulator.open-url'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
    url: z.string().min(1),
  }),
  z.object({
    kind: z.literal('simulator.screenshot'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
    format: SimulatorImageFormatSchema.optional(),
  }),
  z.object({
    kind: z.literal('simulator.screenshotted'),
    replyTo: WireRequestIdSchema,
    format: SimulatorImageFormatSchema,
    /** Base64-encoded image bytes. */
    data: z.string(),
  }),
  /** Read-only devicetype metadata (no session claim): the device's screen-outline mask,
   * rendered host-side from the local Xcode's devicetype bundle. */
  z.object({
    kind: z.literal('simulator.screen-mask'),
    clientReqId: WireRequestIdSchema,
    udid,
  }),
  z.object({
    kind: z.literal('simulator.screen-masked'),
    replyTo: WireRequestIdSchema,
    /** Base64-encoded transparent PNG. */
    data: z.string(),
  }),

  // ── Interactive control + framebuffer streaming (CODE-397; private-API, macOS host only) ──
  // Void commands reply with the generic `request.succeeded`/`request.failed`. Coordinates are
  // normalized 0..1, so a downscaled stream needs no adjustment.
  z.object({
    kind: z.literal('simulator.tap'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
    x: coord,
    y: coord,
  }),
  /** One phase of a streamed touch gesture — the panel forwards pointer events in real time so
   * the device sees the finger during a drag (long-press, rubber-banding, icon drags). */
  z.object({
    kind: z.literal('simulator.touch'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
    phase: SimulatorTouchPhaseSchema,
    x: coord,
    y: coord,
  }),
  z.object({
    kind: z.literal('simulator.swipe'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
    x0: coord,
    y0: coord,
    x1: coord,
    y1: coord,
    durationMs: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal('simulator.button'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
    button: SimulatorButtonSchema,
  }),
  /** One keyboard key press: an HID usage on page 7 with modifier usages (`0xE0..`) held
   * around it. Clients decompose typed characters (US layout) before sending. */
  z.object({
    kind: z.literal('simulator.key'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
    usage: z.number().int().nonnegative(),
    modifiers: z.array(z.number().int().nonnegative()).max(8),
  }),
  z.object({
    kind: z.literal('simulator.stream.start'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
    fps: z.number().int().positive().optional(),
    quality: z.number().min(0).max(1).optional(),
    scale: z.number().min(0).max(1).optional(),
    codec: SimulatorStreamCodecSchema.optional(),
  }),
  z.object({
    kind: z.literal('simulator.stream.started'),
    replyTo: WireRequestIdSchema,
    udid,
    fps: z.number().int(),
    scale: z.number(),
    codec: SimulatorStreamCodecSchema,
  }),
  z.object({
    kind: z.literal('simulator.stream.stop'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
  }),
  /** An unsolicited framebuffer frame while a stream runs. Routed session-scoped (like
   * `agent.event`) so only connections attached to `sessionId` receive it — never a global
   * broadcast, since frames are high-frequency. Base64 rides in JSON like `simulator.screenshotted`;
   * a binary side-channel is a remote/high-fps concern, not v1's desktop-local path. */
  z.object({
    kind: z.literal('simulator.stream.frame'),
    sessionId: SessionIdSchema,
    udid,
    codec: SimulatorStreamCodecSchema,
    /** Sync frame (always true for JPEG; H.264 deltas depend on every frame since the last key). */
    key: z.boolean(),
    /** Base64-encoded frame bytes (JPEG image or Annex-B H.264 access unit). */
    data: z.string(),
  }),
] as const;
