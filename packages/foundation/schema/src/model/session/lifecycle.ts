import { z } from 'zod';
import { AgentKindSchema, SessionIdSchema } from '../primitives';

/** Why a prompt turn ended. */
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

/** Why a session moment is notification-worthy. `turn-completed` keeps the stop reason so clients
 * can skip user-initiated cancels; `awaiting-approval` maps the `permission-request` event. */
export const SessionNotificationReasonSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('turn-completed'), stopReason: StopReasonSchema }),
  z.object({ type: z.literal('awaiting-approval'), toolTitle: z.string().optional() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type SessionNotificationReason = z.infer<typeof SessionNotificationReasonSchema>;

/** A notification-worthy session moment, classified daemon-side so clients don't fold every
 * session's event stream. Carries its own display fields because the session may be absent from
 * a client's list snapshot; whether/how to surface it stays client-side presentation policy. */
export const SessionNotificationSchema = z.object({
  sessionId: SessionIdSchema,
  kind: AgentKindSchema,
  cwd: z.string(),
  title: z.string().optional(),
  reason: SessionNotificationReasonSchema,
});
export type SessionNotification = z.infer<typeof SessionNotificationSchema>;
