import { z } from 'zod';
import { ScheduleIdSchema } from '../model/primitives';
import {
  ScheduleRunSchema,
  ScheduleSchema,
  ScheduleSpecSchema,
  ScheduleUpdateSchema,
} from '../model/schedule';
import { WireRequestIdSchema } from './request';

/**
 * Schedule wire variants. Requests carry `clientReqId`; correlated replies carry `replyTo`;
 * mutations that need no payload back reply with the generic `request.succeeded`/`request.failed`
 * (see wire/request.ts). Broadcasts (no correlation id) carry the routing key inside the record and
 * are fanned to every client, which filters by `scheduleId` — the `script.status` pattern.
 */
export const scheduleWireVariants = [
  z.object({
    kind: z.literal('schedule.create'),
    clientReqId: WireRequestIdSchema,
    spec: ScheduleSpecSchema,
  }),
  z.object({
    kind: z.literal('schedule.created'),
    replyTo: WireRequestIdSchema,
    schedule: ScheduleSchema,
  }),
  z.object({
    kind: z.literal('schedule.update'),
    clientReqId: WireRequestIdSchema,
    scheduleId: ScheduleIdSchema,
    patch: ScheduleUpdateSchema,
  }),
  z.object({
    kind: z.literal('schedule.updated'),
    replyTo: WireRequestIdSchema,
    schedule: ScheduleSchema,
  }),
  /** delete/pause/resume/run-once reply `request.succeeded`/`failed`; state flows via broadcasts. */
  z.object({
    kind: z.literal('schedule.delete'),
    clientReqId: WireRequestIdSchema,
    scheduleId: ScheduleIdSchema,
  }),
  z.object({
    kind: z.literal('schedule.pause'),
    clientReqId: WireRequestIdSchema,
    scheduleId: ScheduleIdSchema,
  }),
  z.object({
    kind: z.literal('schedule.resume'),
    clientReqId: WireRequestIdSchema,
    scheduleId: ScheduleIdSchema,
  }),
  z.object({
    kind: z.literal('schedule.run-once'),
    clientReqId: WireRequestIdSchema,
    scheduleId: ScheduleIdSchema,
  }),
  z.object({
    kind: z.literal('schedule.list'),
    clientReqId: WireRequestIdSchema,
  }),
  z.object({
    kind: z.literal('schedule.listed'),
    replyTo: WireRequestIdSchema,
    schedules: z.array(ScheduleSchema),
  }),
  z.object({
    kind: z.literal('schedule.runs.list'),
    clientReqId: WireRequestIdSchema,
    scheduleId: ScheduleIdSchema,
    limit: z.number().int().min(1).max(500).optional(),
  }),
  z.object({
    kind: z.literal('schedule.runs.listed'),
    replyTo: WireRequestIdSchema,
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
