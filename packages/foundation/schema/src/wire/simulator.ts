import { z } from 'zod';
import { SessionIdSchema } from '../model/primitives';
import {
  SimulatorAxNodeSchema,
  SimulatorButtonSchema,
  SimulatorConsentDecisionSchema,
  SimulatorConsentStateSchema,
  SimulatorDeviceSchema,
  SimulatorImageFormatSchema,
  SimulatorOrientationSchema,
  SimulatorStatusSchema,
  SimulatorStreamCodecSchema,
  SimulatorTouchPhaseSchema,
} from '../model/simulator';
import { WireRequestIdSchema } from './request';

const udid = z.string().min(1);
/** A normalized screen coordinate, 0..1 from the top-left. */
const coord = z.number().min(0).max(1);

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
  /** Start the iOS runtime download (`xcodebuild -downloadPlatform iOS`). Fire-and-forget: it runs
   * for tens of minutes and many gigabytes, so the reply only says it started — progress is
   * observed by re-probing `simulator.status` until the runtime appears. */
  z.object({
    kind: z.literal('simulator.install-runtime'),
    clientReqId: WireRequestIdSchema,
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
    /** Where on the screen the tool acted, normalized 0..1 — present only for the pointer tools,
     * so the panel can show *where* an agent is working and not merely that it is. A swipe reports
     * its origin. Absent for everything that has no single point (boot, screenshot, describe_ui). */
    x: coord.optional(),
    y: coord.optional(),
  }),
  // ── Agent consent ──
  z.object({ kind: z.literal('simulator.consent.get'), clientReqId: WireRequestIdSchema }),
  z.object({
    kind: z.literal('simulator.consent.state'),
    replyTo: WireRequestIdSchema,
    state: SimulatorConsentStateSchema,
  }),
  /** Record (or overwrite) a device decision; `decision` absent clears it back to "never asked". */
  z.object({
    kind: z.literal('simulator.consent.set'),
    clientReqId: WireRequestIdSchema,
    udid,
    decision: SimulatorConsentDecisionSchema.optional(),
  }),
  /** Flip the global kill switch — every simulator MCP tool is refused while it is off. */
  z.object({
    kind: z.literal('simulator.consent.set-agent-tools'),
    clientReqId: WireRequestIdSchema,
    enabled: z.boolean(),
  }),
  /** An agent tool is waiting on a decision for `udid`. Broadcast: any attached client may answer,
   * and the panel showing that device raises the prompt. */
  z.object({
    kind: z.literal('simulator.consent.required'),
    sessionId: SessionIdSchema,
    udid,
    tool: z.string(),
  }),
  /** Consent state changed (a decision, a clear, or the kill switch) — keeps every client honest. */
  z.object({
    kind: z.literal('simulator.consent.changed'),
    state: SimulatorConsentStateSchema,
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

  // ── Interactive control + framebuffer streaming (macOS host only) ──
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
  /** One phase of a streamed two-finger gesture (pinch/zoom); both finger positions normalized. */
  z.object({
    kind: z.literal('simulator.pinch'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
    phase: SimulatorTouchPhaseSchema,
    x0: coord,
    y0: coord,
    x1: coord,
    y1: coord,
  }),
  /** Set the device pasteboard; clients pair it with a Cmd+V key press to inject arbitrary
   * Unicode (IME output, emoji) the US-ASCII key path cannot type. */
  z.object({
    kind: z.literal('simulator.paste'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
    text: z.string(),
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
  /** Shake the device. Not HID and not a GSEvent: UIKit inside the guest listens for a Darwin
   * notification, which is the route Simulator.app's own Device menu takes. */
  z.object({
    kind: z.literal('simulator.shake'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
  }),
  /** Rotate the device's interface orientation (a GraphicsServices GSEvent, not HID). A guest app
   * that doesn't support the target orientation silently keeps its frame — not observable here. */
  z.object({
    kind: z.literal('simulator.rotate'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
    orientation: SimulatorOrientationSchema,
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
  /** Read the frontmost app's accessibility tree. Costs a chain of XPC round-trips into the guest,
   * so it is a request/reply command rather than anything stream-shaped. */
  z.object({
    kind: z.literal('simulator.describe-ui'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    udid,
    maxDepth: z.number().int().nonnegative().max(64).optional(),
    maxNodes: z.number().int().positive().max(5000).optional(),
  }),
  z.object({
    kind: z.literal('simulator.described-ui'),
    replyTo: WireRequestIdSchema,
    udid,
    tree: SimulatorAxNodeSchema,
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
