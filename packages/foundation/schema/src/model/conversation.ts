import { z } from 'zod';
import {
  AttachmentIdSchema,
  OperationIdSchema,
  PromptIdSchema,
  RunIdSchema,
  SessionIdSchema,
  TimestampSchema,
  TurnIdSchema,
} from './primitives';

/**
 * The conversation turn tree: host-authoritative turn identity and durable user prompts.
 * Every turn has a parent (null = child of the session root); siblings under one parent are the
 * prompt-edit variants; a "branch" is just the path from root to a leaf. Assistant/tool output
 * stays provider-local and is projected via `ProviderTurnBinding`.
 */

/** One block of a durable prompt — references only, never bytes, never absolute paths. */
export const PromptBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('attachment_ref'), attachmentId: AttachmentIdSchema }),
]);
export type PromptBlock = z.infer<typeof PromptBlockSchema>;

/** Immutable user-authored prompt; shared by reference across session forks. */
export const PromptRecordSchema = z.object({
  promptId: PromptIdSchema,
  blocks: z.array(PromptBlockSchema),
  /** Snapshot of the ready session sources at submit time. */
  contextAttachmentIds: z.array(AttachmentIdSchema),
  createdAt: TimestampSchema,
});
export type PromptRecord = z.infer<typeof PromptRecordSchema>;

/** What started the turn — mirrors the turn-starting `AgentInput` variants: command and
 * shell-command start turns today and must be first-class, or ordinals and checkpoints
 * misalign with provider history. */
export const TurnInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('prompt'),
    /** null is reserved for lossy migrated replay; a live submit always mints a prompt record. */
    promptId: PromptIdSchema.nullable(),
  }),
  z.object({
    type: z.literal('command'),
    name: z.string().min(1),
    arguments: z.string().optional(),
  }),
  z.object({ type: z.literal('shell-command'), command: z.string().min(1) }),
]);
export type TurnInput = z.infer<typeof TurnInputSchema>;

export const ConversationTurnStateSchema = z.enum([
  'preparing',
  'dispatching',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type ConversationTurnState = z.infer<typeof ConversationTurnStateSchema>;

/** One node of the persisted turn tree. Never deleted except with its whole session. */
export const ConversationTurnSchema = z.object({
  turnId: TurnIdSchema,
  sessionId: SessionIdSchema,
  /** null = child of the session root. */
  parentTurnId: TurnIdSchema.nullable(),
  /** 1-based position among the parent's children; assigned at durable creation, stable forever. */
  siblingOrdinal: z.number().int().min(1),
  input: TurnInputSchema,
  /** The `SessionRun` that executed this turn — explicit, never positional. */
  runId: RunIdSchema,
  state: ConversationTurnStateSchema,
  createdAt: TimestampSchema,
});
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;

/** One row per (turn, provider history) — forks re-bind. `checkpoint` is adapter-opaque, the same
 * discipline as the history branch cursor. */
export const ProviderTurnBindingSchema = z.object({
  turnId: TurnIdSchema,
  runId: RunIdSchema,
  historyId: z.string().min(1),
  checkpoint: z.string().min(1),
  /** Minted at turn end live, or during a cold read. */
  capturedFrom: z.enum(['live', 'replay']),
});
export type ProviderTurnBinding = z.infer<typeof ProviderTurnBindingSchema>;

export const ConversationOperationKindSchema = z.enum(['turn.submit']);
export type ConversationOperationKind = z.infer<typeof ConversationOperationKindSchema>;

/** Durable idempotency journal for conversation mutations: consulted before any validation, so a
 * reply lost to a disconnect replays the terminal result instead of duplicating a sibling. */
export const ConversationOperationSchema = z.discriminatedUnion('state', [
  z.object({
    operationId: OperationIdSchema,
    sessionId: SessionIdSchema,
    kind: ConversationOperationKindSchema,
    state: z.literal('open'),
    createdAt: TimestampSchema,
  }),
  z.object({
    operationId: OperationIdSchema,
    sessionId: SessionIdSchema,
    kind: ConversationOperationKindSchema,
    state: z.literal('succeeded'),
    turnId: TurnIdSchema,
    createdAt: TimestampSchema,
    resolvedAt: TimestampSchema,
  }),
  z.object({
    operationId: OperationIdSchema,
    sessionId: SessionIdSchema,
    kind: ConversationOperationKindSchema,
    state: z.literal('failed'),
    error: z.object({ code: z.string().min(1), message: z.string() }),
    createdAt: TimestampSchema,
    resolvedAt: TimestampSchema,
  }),
]);
export type ConversationOperation = z.infer<typeof ConversationOperationSchema>;

/** Daemon-minted event-plane position: `epoch` bumps on run launch and daemon boot, `seq` is
 * monotone within an epoch. Merge rule is lexicographic. */
export const ConversationWatermarkSchema = z.object({
  epoch: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
});
export type ConversationWatermark = z.infer<typeof ConversationWatermarkSchema>;

/** Lexicographic `(epoch, seq)` order: an event at or below a watermark is dropped by the merge
 * rule, so any straggler from an older epoch compares below every position of a newer one. */
export function compareConversationWatermarks(
  a: ConversationWatermark,
  b: ConversationWatermark,
): number {
  return a.epoch === b.epoch ? a.seq - b.seq : a.epoch - b.epoch;
}
