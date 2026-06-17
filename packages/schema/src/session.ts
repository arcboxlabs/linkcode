import { z } from 'zod';
import { AgentKindSchema, SessionIdSchema } from './common';

/** Session modes — mirrors ACP SessionMode / SessionModeState. */
export const SessionModeIdSchema = z.string().min(1);
export type SessionModeId = z.infer<typeof SessionModeIdSchema>;

export const SessionModeSchema = z.object({
  modeId: SessionModeIdSchema,
  name: z.string(),
  description: z.string().optional(),
});
export type SessionMode = z.infer<typeof SessionModeSchema>;

export const SessionModeStateSchema = z.object({
  availableModes: z.array(SessionModeSchema),
  currentModeId: SessionModeIdSchema,
});
export type SessionModeState = z.infer<typeof SessionModeStateSchema>;

/** Slash commands the agent advertises — mirrors ACP AvailableCommand. */
export const AvailableCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  input: z.object({ hint: z.string() }).optional(),
});
export type AvailableCommand = z.infer<typeof AvailableCommandSchema>;

/** A free-form per-session config option the agent exposes — mirrors ACP config_option_update. */
export const SessionConfigOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  value: z.unknown(),
});
export type SessionConfigOption = z.infer<typeof SessionConfigOptionSchema>;

/** Why a prompt turn ended — mirrors ACP StopReason. (Verify the enum against the shipped SDK.) */
export const StopReasonSchema = z.enum([
  'end_turn',
  'max_tokens',
  'max_turn_requests',
  'refusal',
  'cancelled',
]);
export type StopReason = z.infer<typeof StopReasonSchema>;

/** Link Code's own coarse lifecycle state for a session. */
export const SessionStatusSchema = z.enum([
  'starting',
  'idle',
  'running',
  'awaiting-input',
  'stopped',
]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/** An MCP server the agent should connect to (passed at session start). */
export const McpServerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stdio'),
    name: z.string(),
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('http'),
    name: z.string(),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
]);
export type McpServer = z.infer<typeof McpServerSchema>;

/** Summary of a live session, for session.list and multi-client attach. */
export const SessionInfoSchema = z.object({
  sessionId: SessionIdSchema,
  kind: AgentKindSchema,
  cwd: z.string(),
  status: SessionStatusSchema,
  createdAt: z.number().int().nonnegative(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
