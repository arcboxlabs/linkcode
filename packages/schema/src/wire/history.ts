import { z } from 'zod';
import { StartOptionsSchema } from '../model/agent';
import {
  AgentHistoryListOptionsSchema,
  AgentHistoryListResultSchema,
  AgentHistoryReadOptionsSchema,
  AgentHistoryReadResultSchema,
} from '../model/history';
import { AgentHistoryIdSchema, AgentKindSchema } from '../model/primitives';
import { WireRequestIdSchema } from './request';

export const AgentHistoryListWireOptionsSchema = AgentHistoryListOptionsSchema.extend({
  forceRefresh: z.boolean().optional(),
});
export type AgentHistoryListWireOptions = z.infer<typeof AgentHistoryListWireOptionsSchema>;

export const AgentHistoryReadWireOptionsSchema = AgentHistoryReadOptionsSchema.extend({
  forceRefresh: z.boolean().optional(),
});
export type AgentHistoryReadWireOptions = z.infer<typeof AgentHistoryReadWireOptionsSchema>;

/** Historical-session wire variants. */
export const historyWireVariants = [
  z.object({
    kind: z.literal('history.list'),
    clientReqId: WireRequestIdSchema,
    agentKind: AgentKindSchema,
    opts: AgentHistoryListWireOptionsSchema.optional(),
  }),
  z.object({
    kind: z.literal('history.listed'),
    replyTo: WireRequestIdSchema,
    result: AgentHistoryListResultSchema,
  }),
  z.object({
    kind: z.literal('history.read'),
    clientReqId: WireRequestIdSchema,
    agentKind: AgentKindSchema,
    opts: AgentHistoryReadWireOptionsSchema,
  }),
  z.object({
    kind: z.literal('history.read.result'),
    replyTo: WireRequestIdSchema,
    result: AgentHistoryReadResultSchema,
  }),
  z.object({
    kind: z.literal('history.resume'),
    clientReqId: WireRequestIdSchema,
    agentKind: AgentKindSchema,
    historyId: AgentHistoryIdSchema,
    startOpts: StartOptionsSchema,
  }),
] as const;
