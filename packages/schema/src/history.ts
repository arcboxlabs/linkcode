import { z } from 'zod';
import { AgentEventSchema } from './agent';
import { AgentKindSchema, TimestampSchema } from './common';

/** Provider-local history id, e.g. a Claude Code session id or a future Codex thread id. */
export const AgentHistoryIdSchema = z.string().min(1).brand<'AgentHistoryId'>();
export type AgentHistoryId = z.infer<typeof AgentHistoryIdSchema>;

/** History capabilities can vary by adapter and by installed SDK/runtime version. */
export const AgentHistoryCapabilitiesSchema = z.object({
  /** Adapter can list provider-local historical sessions. */
  list: z.boolean(),
  /** Adapter can read/replay a provider-local historical session into normalized events. */
  read: z.boolean(),
  /** Adapter can resume a live session from a known provider-local history id. */
  resume: z.boolean(),
});
export type AgentHistoryCapabilities = z.infer<typeof AgentHistoryCapabilitiesSchema>;

/** Summary row for one provider-local historical session. */
export const AgentHistorySessionSchema = z.object({
  historyId: AgentHistoryIdSchema,
  kind: AgentKindSchema,
  title: z.string().optional(),
  cwd: z.string().optional(),
  model: z.string().optional(),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
  messageCount: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AgentHistorySession = z.infer<typeof AgentHistorySessionSchema>;

export const AgentHistoryListOptionsSchema = z.object({
  cwd: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
  cursor: z.string().optional(),
});
export type AgentHistoryListOptions = z.infer<typeof AgentHistoryListOptionsSchema>;

export const AgentHistoryListResultSchema = z.object({
  sessions: z.array(AgentHistorySessionSchema),
  cursor: z.string().optional(),
});
export type AgentHistoryListResult = z.infer<typeof AgentHistoryListResultSchema>;

export const AgentHistoryReadOptionsSchema = z.object({
  historyId: AgentHistoryIdSchema,
  limit: z.number().int().positive().max(1000).optional(),
  cursor: z.string().optional(),
});
export type AgentHistoryReadOptions = z.infer<typeof AgentHistoryReadOptionsSchema>;

/** One normalized historical event. `itemId` preserves the provider's event/message id when available. */
export const AgentHistoryEventSchema = z.object({
  historyId: AgentHistoryIdSchema,
  itemId: z.string().optional(),
  ts: TimestampSchema.optional(),
  event: AgentEventSchema,
});
export type AgentHistoryEvent = z.infer<typeof AgentHistoryEventSchema>;

export const AgentHistoryReadResultSchema = z.object({
  session: AgentHistorySessionSchema,
  events: z.array(AgentHistoryEventSchema),
  cursor: z.string().optional(),
});
export type AgentHistoryReadResult = z.infer<typeof AgentHistoryReadResultSchema>;

export const AgentHistoryResumeOptionsSchema = z.object({
  historyId: AgentHistoryIdSchema,
});
export type AgentHistoryResumeOptions = z.infer<typeof AgentHistoryResumeOptionsSchema>;
