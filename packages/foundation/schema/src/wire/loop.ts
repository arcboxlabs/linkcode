import { z } from 'zod';
import {
  LoopInspectionSchema,
  LoopIterationSchema,
  LoopLogEntrySchema,
  LoopRecordSchema,
  LoopSpecSchema,
} from '../model/loop';
import { LoopIdSchema } from '../model/primitives';
import { WireRequestIdSchema } from './request';

/**
 * Loop wire variants. Same conventions as wire/schedule.ts: requests carry `clientReqId`; correlated
 * replies carry `replyTo`; mutations with no payload back reply with the generic
 * `request.succeeded`/`request.failed`. Broadcasts (no correlation id) carry their routing key inside
 * the payload and are fanned to every client. Because a loop streams a live log, `loop.inspect`
 * returns a snapshot (record + iterations + ring-buffered logs) which clients fold with the
 * `loop.iteration` / `loop.log` broadcast increments.
 */
export const loopWireVariants = [
  z.object({
    kind: z.literal('loop.start'),
    clientReqId: WireRequestIdSchema,
    spec: LoopSpecSchema,
  }),
  z.object({
    kind: z.literal('loop.started'),
    replyTo: WireRequestIdSchema,
    loop: LoopRecordSchema,
  }),
  /** stop/delete reply `request.succeeded`/`failed`; state flows via broadcasts. */
  z.object({
    kind: z.literal('loop.stop'),
    clientReqId: WireRequestIdSchema,
    loopId: LoopIdSchema,
  }),
  z.object({
    kind: z.literal('loop.delete'),
    clientReqId: WireRequestIdSchema,
    loopId: LoopIdSchema,
  }),
  z.object({
    kind: z.literal('loop.list'),
    clientReqId: WireRequestIdSchema,
  }),
  z.object({
    kind: z.literal('loop.listed'),
    replyTo: WireRequestIdSchema,
    loops: z.array(LoopRecordSchema),
  }),
  z.object({
    kind: z.literal('loop.inspect'),
    clientReqId: WireRequestIdSchema,
    loopId: LoopIdSchema,
  }),
  z.object({
    kind: z.literal('loop.inspected'),
    replyTo: WireRequestIdSchema,
    ...LoopInspectionSchema.shape,
  }),
  /** Broadcast on start/settle and status change — whole-record replace by `loopId`. */
  z.object({
    kind: z.literal('loop.changed'),
    loop: LoopRecordSchema,
  }),
  z.object({
    kind: z.literal('loop.removed'),
    loopId: LoopIdSchema,
  }),
  /** Broadcast on iteration start and settle — replace by (`loopId`, `index`). */
  z.object({
    kind: z.literal('loop.iteration'),
    iteration: LoopIterationSchema,
  }),
  /** Broadcast per live log line — appended by monotonic `seq`. */
  z.object({
    kind: z.literal('loop.log'),
    loopId: LoopIdSchema,
    entry: LoopLogEntrySchema,
  }),
] as const;
