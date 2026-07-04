import { z } from 'zod';
import { StartOptionsSchema } from '../agent';
import { AgentHistoryIdSchema, AgentKindSchema } from '../common';
import {
  AgentHistoryListOptionsSchema,
  AgentHistoryListResultSchema,
  AgentHistoryReadOptionsSchema,
  AgentHistoryReadResultSchema,
} from '../history';

export const AgentHistoryListWireOptionsSchema = AgentHistoryListOptionsSchema.extend({
  forceRefresh: z.boolean().optional(),
});
export type AgentHistoryListWireOptions = z.infer<typeof AgentHistoryListWireOptionsSchema>;

export const AgentHistoryReadWireOptionsSchema = AgentHistoryReadOptionsSchema.extend({
  forceRefresh: z.boolean().optional(),
});
export type AgentHistoryReadWireOptions = z.infer<typeof AgentHistoryReadWireOptionsSchema>;

/**
 * Historical-session wire variants, plus the generic correlated-request reply pair
 * (`request.failed` / `request.succeeded`) every request/reply `kind` can resolve to.
 */
export const historyWireVariants = [
  z.object({
    kind: z.literal('history.list'),
    clientReqId: z.string().min(1),
    agentKind: AgentKindSchema,
    opts: AgentHistoryListWireOptionsSchema.optional(),
  }),
  z.object({
    kind: z.literal('history.listed'),
    replyTo: z.string().min(1),
    result: AgentHistoryListResultSchema,
  }),
  z.object({
    kind: z.literal('history.read'),
    clientReqId: z.string().min(1),
    agentKind: AgentKindSchema,
    opts: AgentHistoryReadWireOptionsSchema,
  }),
  z.object({
    kind: z.literal('history.read.result'),
    replyTo: z.string().min(1),
    result: AgentHistoryReadResultSchema,
  }),
  z.object({
    kind: z.literal('history.resume'),
    clientReqId: z.string().min(1),
    agentKind: AgentKindSchema,
    historyId: AgentHistoryIdSchema,
    startOpts: StartOptionsSchema,
  }),
  z.object({
    kind: z.literal('request.failed'),
    replyTo: z.string().min(1),
    message: z.string(),
    code: z.string().optional(),
  }),
  z.object({
    kind: z.literal('request.succeeded'),
    replyTo: z.string().min(1),
  }),
] as const;
