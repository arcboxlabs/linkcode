import { z } from 'zod';
import { StartOptionsSchema } from '../model/agent';
import { AgentHistoryIdSchema, AgentKindSchema, SessionIdSchema } from '../model/primitives';
import {
  SessionInfoSchema,
  SessionNotificationSchema,
  SessionRecordSchema,
} from '../model/session';

/** Session control wire variants — starting, stopping, listing, and resuming sessions. */
export const sessionWireVariants = [
  z.object({
    kind: z.literal('session.start'),
    clientReqId: z.string().min(1),
    opts: StartOptionsSchema,
  }),
  z.object({
    kind: z.literal('session.started'),
    replyTo: z.string().min(1),
    sessionId: SessionIdSchema,
  }),
  z.object({
    kind: z.literal('session.stop'),
    clientReqId: z.string().min(1),
    sessionId: SessionIdSchema,
  }),
  /** Stop the session if live and remove its persisted record; provider-local history survives for re-import. */
  z.object({
    kind: z.literal('session.delete'),
    clientReqId: z.string().min(1),
    sessionId: SessionIdSchema,
  }),
  z.object({ kind: z.literal('session.list'), clientReqId: z.string().min(1) }),
  z.object({
    kind: z.literal('session.listed'),
    replyTo: z.string().min(1),
    sessions: z.array(SessionInfoSchema),
  }),
  z.object({ kind: z.literal('session.attach'), sessionId: SessionIdSchema }),
  z.object({ kind: z.literal('session.detach'), sessionId: SessionIdSchema }),
  /** Connection-scoped `agent.event` delivery (answered by the Hub, not the Engine). `all` — the
   * default for every new connection — is the historical broadcast behavior; `attached` narrows
   * delivery to sessions the connection subscribed via `session.attach`. */
  z.object({
    kind: z.literal('subscription.set'),
    clientReqId: z.string().min(1),
    mode: z.enum(['all', 'attached']),
  }),
  /** Resume a persisted (cold) session by its Link Code id; replies `session.started` with the SAME id. */
  z.object({
    kind: z.literal('session.resume'),
    clientReqId: z.string().min(1),
    sessionId: SessionIdSchema,
  }),
  /** Import a provider-local history session as a cold record (listed, not started). */
  z.object({
    kind: z.literal('session.import'),
    clientReqId: z.string().min(1),
    agentKind: AgentKindSchema,
    historyId: AgentHistoryIdSchema,
  }),
  z.object({
    kind: z.literal('session.imported'),
    replyTo: z.string().min(1),
    record: SessionRecordSchema,
  }),
  /** Broadcast on a notification-worthy session moment: no replyTo, fanned out to every client.
   * Must stay a broadcast even once per-connection subscription modes exist (CODE-72) —
   * background sessions on other devices drive OS notifications through this frame. */
  z.object({
    kind: z.literal('session.notification'),
    notification: SessionNotificationSchema,
  }),
] as const;
