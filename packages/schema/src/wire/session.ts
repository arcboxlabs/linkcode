import { z } from 'zod';
import { StartOptionsSchema } from '../agent';
import { AgentHistoryIdSchema, AgentKindSchema, SessionIdSchema } from '../common';
import { SessionInfoSchema, SessionRecordSchema } from '../session';

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
] as const;
