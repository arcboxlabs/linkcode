import { z } from 'zod';
import { LoopIdSchema } from '../common';
import { LoopIterationSchema, LoopLogEntrySchema, LoopRecordSchema, LoopSpecSchema } from '../loop';

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
    clientReqId: z.string().min(1),
    spec: LoopSpecSchema,
  }),
  z.object({
    kind: z.literal('loop.started'),
    replyTo: z.string().min(1),
    loop: LoopRecordSchema,
  }),
  /** stop/delete reply `request.succeeded`/`failed`; state flows via broadcasts. */
  z.object({
    kind: z.literal('loop.stop'),
    clientReqId: z.string().min(1),
    loopId: LoopIdSchema,
  }),
  z.object({
    kind: z.literal('loop.delete'),
    clientReqId: z.string().min(1),
    loopId: LoopIdSchema,
  }),
  z.object({
    kind: z.literal('loop.list'),
    clientReqId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('loop.listed'),
    replyTo: z.string().min(1),
    loops: z.array(LoopRecordSchema),
  }),
  z.object({
    kind: z.literal('loop.inspect'),
    clientReqId: z.string().min(1),
    loopId: LoopIdSchema,
  }),
  z.object({
    kind: z.literal('loop.inspected'),
    replyTo: z.string().min(1),
    loop: LoopRecordSchema,
    iterations: z.array(LoopIterationSchema),
    logs: z.array(LoopLogEntrySchema),
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
