import { z } from 'zod';
import { ScheduleIdSchema } from '../common';
import {
  ScheduleRunSchema,
  ScheduleSchema,
  ScheduleSpecSchema,
  ScheduleUpdateSchema,
} from '../schedule';

/**
 * Schedule wire variants. Requests carry `clientReqId`; correlated replies carry `replyTo`;
 * mutations that need no payload back reply with the generic `request.succeeded`/`request.failed`
 * (see wire/history.ts). Broadcasts (no correlation id) carry the routing key inside the record and
 * are fanned to every client, which filters by `scheduleId` — the `script.status` pattern.
 */
export const scheduleWireVariants = [
  z.object({
    kind: z.literal('schedule.create'),
    clientReqId: z.string().min(1),
    spec: ScheduleSpecSchema,
  }),
  z.object({
    kind: z.literal('schedule.created'),
    replyTo: z.string().min(1),
    schedule: ScheduleSchema,
  }),
  z.object({
    kind: z.literal('schedule.update'),
    clientReqId: z.string().min(1),
    scheduleId: ScheduleIdSchema,
    patch: ScheduleUpdateSchema,
  }),
  z.object({
    kind: z.literal('schedule.updated'),
    replyTo: z.string().min(1),
    schedule: ScheduleSchema,
  }),
  /** delete/pause/resume/run-once reply `request.succeeded`/`failed`; state flows via broadcasts. */
  z.object({
    kind: z.literal('schedule.delete'),
    clientReqId: z.string().min(1),
    scheduleId: ScheduleIdSchema,
  }),
  z.object({
    kind: z.literal('schedule.pause'),
    clientReqId: z.string().min(1),
    scheduleId: ScheduleIdSchema,
  }),
  z.object({
    kind: z.literal('schedule.resume'),
    clientReqId: z.string().min(1),
    scheduleId: ScheduleIdSchema,
  }),
  z.object({
    kind: z.literal('schedule.run-once'),
    clientReqId: z.string().min(1),
    scheduleId: ScheduleIdSchema,
  }),
  z.object({
    kind: z.literal('schedule.list'),
    clientReqId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('schedule.listed'),
    replyTo: z.string().min(1),
    schedules: z.array(ScheduleSchema),
  }),
  z.object({
    kind: z.literal('schedule.runs.list'),
    clientReqId: z.string().min(1),
    scheduleId: ScheduleIdSchema,
    limit: z.number().int().min(1).max(500).optional(),
  }),
  z.object({
    kind: z.literal('schedule.runs.listed'),
    replyTo: z.string().min(1),
    runs: z.array(ScheduleRunSchema),
  }),
  /** Broadcast on create/update/pause/resume/complete — whole-record replace by `scheduleId`. */
  z.object({
    kind: z.literal('schedule.changed'),
    schedule: ScheduleSchema,
  }),
  z.object({
    kind: z.literal('schedule.removed'),
    scheduleId: ScheduleIdSchema,
  }),
  /** Broadcast on run start and settle — replace by `runId`. */
  z.object({
    kind: z.literal('schedule.run'),
    run: ScheduleRunSchema,
  }),
] as const;
