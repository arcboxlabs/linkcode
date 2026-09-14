import { z } from 'zod';
import { AgentEventSchema } from '../model/agent';
import {
  ConversationTurnSchema,
  ConversationWatermarkSchema,
  PromptBlockSchema,
} from '../model/conversation';
import {
  OperationIdSchema,
  RunIdSchema,
  SessionIdSchema,
  TimestampSchema,
  TurnIdSchema,
} from '../model/primitives';
import { WireRequestIdSchema } from './request';

/** What a submit carries over the wire. Prompt content travels as blocks — the daemon mints the
 * durable `PromptRecord` (and its id) when it persists the turn intent. */
export const TurnSubmitInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('prompt'), blocks: z.array(PromptBlockSchema).min(1) }),
  z.object({
    type: z.literal('command'),
    name: z.string().min(1),
    arguments: z.string().optional(),
  }),
  z.object({ type: z.literal('shell-command'), command: z.string().min(1) }),
]);
export type TurnSubmitInput = z.infer<typeof TurnSubmitInputSchema>;

/** One projected event of a conversation read: provider history attributed to its turn/run, plus
 * the live tail (which alone carries `epoch`/`seq` for the watermark merge). */
export const ConversationEventSchema = z.object({
  turnId: TurnIdSchema.optional(),
  runId: RunIdSchema.optional(),
  epoch: z.number().int().nonnegative().optional(),
  seq: z.number().int().nonnegative().optional(),
  ts: TimestampSchema.optional(),
  event: AgentEventSchema,
});
export type ConversationEvent = z.infer<typeof ConversationEventSchema>;

/** Conversation-graph wire variants. `turn.submit`'s parent/revision contract: `parentTurnId`
 * ABSENT = plain send onto the active leaf; `null` = new root lineage; a turn id = edit/continue
 * under that turn. `expectedGraphRevision` is required iff `parentTurnId` is present (enforced by
 * the payload-level refinement in payload.ts). */
export const conversationWireVariants = [
  z.object({
    kind: z.literal('turn.submit'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    /** Idempotency key: a retried operation replays the stored terminal result. */
    operationId: OperationIdSchema,
    input: TurnSubmitInputSchema,
    parentTurnId: TurnIdSchema.nullable().optional(),
    expectedGraphRevision: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('turn.submitted'),
    replyTo: WireRequestIdSchema,
    turnId: TurnIdSchema,
  }),
  z.object({
    kind: z.literal('conversation.graph.get'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
  }),
  z.object({
    kind: z.literal('conversation.graph.result'),
    replyTo: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    graphRevision: z.number().int().nonnegative(),
    activeLeafTurnId: TurnIdSchema.optional(),
    turns: z.array(ConversationTurnSchema),
  }),
  /** Session-scoped broadcast: the graph changed shape or moved its default leaf; clients holding
   * a stale snapshot revalidate via `conversation.graph.get`. */
  z.object({
    kind: z.literal('conversation.graph.changed'),
    sessionId: SessionIdSchema,
    graphRevision: z.number().int().nonnegative(),
    activeLeafTurnId: TurnIdSchema.optional(),
  }),
  z.object({
    kind: z.literal('conversation.read'),
    clientReqId: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    /** Absent = the session's active leaf. */
    leafTurnId: TurnIdSchema.optional(),
    cursor: z.string().optional(),
    limit: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal('conversation.read.result'),
    replyTo: WireRequestIdSchema,
    sessionId: SessionIdSchema,
    graphRevision: z.number().int().nonnegative(),
    /** The leaf the projection was read toward; absent while the session has no turns. */
    leafTurnId: TurnIdSchema.optional(),
    /** Merge cut for the live event plane; only the final page's watermark is authoritative. */
    watermark: ConversationWatermarkSchema,
    events: z.array(ConversationEventSchema),
    cursor: z.string().optional(),
  }),
] as const;
