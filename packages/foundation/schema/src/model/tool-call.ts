import { z } from 'zod';
import { ContentBlockSchema } from './content';

/** Tool calls. `ToolCallSchema` is the full materialized state on the wire (every `tool-call`
 * event is a complete snapshot); `ToolCallUpdateSchema` is the partial patch an adapter feeds
 * `emitTool`, which merges it into the running snapshot before emitting. */

export const ToolKindSchema = z.enum([
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'task',
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

export const ToolDiffChangeSchema = z.enum(['modify', 'add', 'delete', 'move', 'copy']);
export type ToolDiffChange = z.infer<typeof ToolDiffChangeSchema>;

export const ToolDiffPatchSchema = z.object({
  format: z.literal('git_patch'),
  text: z.string(),
});
export type ToolDiffPatch = z.infer<typeof ToolDiffPatchSchema>;

/** Tool-call output content: a wrapped ContentBlock, a file diff, or a live terminal reference. */
export const ToolCallContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content'), content: ContentBlockSchema }),
  z.object({
    type: z.literal('diff'),
    /** Omitted only for legacy oldText/newText snapshots. */
    change: ToolDiffChangeSchema.optional(),
    path: z.string(),
    oldPath: z.string().optional(),
    oldText: z.string().optional(),
    newText: z.string().optional(),
    patch: ToolDiffPatchSchema.optional(),
    isBinary: z.boolean().optional(),
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
  /** Set on calls a subagent made: the `task`-kind tool call that spawned it. */
  parentToolCallId: z.string().min(1).optional(),
  content: z.array(ToolCallContentSchema).default([]),
  locations: z.array(ToolCallLocationSchema).optional(),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

/** Incremental adapter-side tool-call update (everything optional except the id).
 * Omitted fields preserve the running snapshot. Null clears optional snapshot fields; null content
 * resets the required content array to empty. */
export const ToolCallUpdateSchema = z.object({
  toolCallId: z.string().min(1),
  title: z.string().optional(),
  kind: ToolKindSchema.optional(),
  status: ToolCallStatusSchema.optional(),
  parentToolCallId: z.string().min(1).nullable().optional(),
  content: z.array(ToolCallContentSchema).nullable().optional(),
  locations: z.array(ToolCallLocationSchema).nullable().optional(),
  rawInput: z.unknown().optional(),
  rawOutput: z.unknown().optional(),
});
export type ToolCallUpdate = z.infer<typeof ToolCallUpdateSchema>;
