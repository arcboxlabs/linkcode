import { z } from 'zod';
import { ContentBlockSchema } from './content';

/**
 * Tool calls — mirrors ACP ToolCall / ToolCallUpdate. See https://agentclientprotocol.com/protocol/tool-calls.
 * NOTE: the `kind` / `status` enums follow ACP's ToolKind / ToolCallStatus; verify against the shipped
 * @agentclientprotocol/sdk types when wiring the ACP adapter (docs were inconsistent on the kind set).
 */

export const ToolKindSchema = z.enum([
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'other',
]);
export type ToolKind = z.infer<typeof ToolKindSchema>;

export const ToolCallStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']);
export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>;

/** A file location a tool call touched (drives the editor "follow-along" affordance). */
export const ToolCallLocationSchema = z.object({
  path: z.string(),
  line: z.number().int().optional(),
});
export type ToolCallLocation = z.infer<typeof ToolCallLocationSchema>;

/** Tool-call output content: a wrapped ContentBlock, a file diff, or a live terminal reference. */
export const ToolCallContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content'), content: ContentBlockSchema }),
  z.object({
    type: z.literal('diff'),
    path: z.string(),
    oldText: z.string().optional(),
    newText: z.string(),
  }),
  z.object({ type: z.literal('terminal'), terminalId: z.string() }),
]);
export type ToolCallContent = z.infer<typeof ToolCallContentSchema>;

/** Initial tool call (core fields present). */
export const ToolCallSchema = z.object({
  toolCallId: z.string().min(1),
  title: z.string(),
  kind: ToolKindSchema,
  status: ToolCallStatusSchema,
  content: z.array(ToolCallContentSchema).default([]),
  locations: z.array(ToolCallLocationSchema).optional(),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** Incremental tool-call update (everything optional except the id). */
export const ToolCallUpdateSchema = z.object({
  toolCallId: z.string().min(1),
  title: z.string().optional(),
  kind: ToolKindSchema.optional(),
  status: ToolCallStatusSchema.optional(),
  content: z.array(ToolCallContentSchema).optional(),
  locations: z.array(ToolCallLocationSchema).optional(),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
});
export type ToolCallUpdate = z.infer<typeof ToolCallUpdateSchema>;
