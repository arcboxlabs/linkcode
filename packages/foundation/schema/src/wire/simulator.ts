import { z } from 'zod';
import { SessionIdSchema } from '../model/primitives';
import {
  SimulatorDeviceSchema,
  SimulatorImageFormatSchema,
  SimulatorStatusSchema,
} from '../model/simulator';
import { WireRequestIdSchema } from './request';

const udid = z.string().min(1);

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
] as const;
