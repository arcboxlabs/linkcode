import { z } from 'zod';
import { AgentEventSchema, AgentInputSchema, StartOptionsSchema } from './agent';
import {
  AgentHistoryIdSchema,
  AgentKindSchema,
  MessageIdSchema,
  SessionIdSchema,
  TimestampSchema,
  WorkspaceIdSchema,
} from './common';
import { GitDiffModeSchema, GitDiffSchema, GitPullRequestStatusSchema, GitStatusSchema } from './git';
import {
  AgentHistoryListOptionsSchema,
  AgentHistoryListResultSchema,
  AgentHistoryReadOptionsSchema,
  AgentHistoryReadResultSchema,
} from './history';
import { ProvidersConfigSchema } from './provider-config';
import { SessionInfoSchema, SessionRecordSchema } from './session';
import { WorkspaceKindSchema, WorkspaceRecordSchema } from './workspace';

/**
 * Wire protocol: the envelope actually transmitted by the transport layer (PLAN §6).
 * Local direct connection (LocalTransport) and remote tunnel (WsTransport) share the same format (PLAN §2.6).
 * Validate with zod at the trust boundary both before sending and after receiving (PLAN §2.1).
 *
 * v2: the daemon serves multiple clients, so `agent.event` is broadcast to all attached clients of a
 * session. Request/response control messages carry a correlation id (`clientReqId` → `replyTo`) so the
 * originating client can pair the reply despite the broadcast.
 */

export const WIRE_PROTOCOL_VERSION = 9 as const;

export const AgentHistoryListWireOptionsSchema = AgentHistoryListOptionsSchema.extend({
  forceRefresh: z.boolean().optional(),
});
export type AgentHistoryListWireOptions = z.infer<typeof AgentHistoryListWireOptionsSchema>;

export const AgentHistoryReadWireOptionsSchema = AgentHistoryReadOptionsSchema.extend({
  forceRefresh: z.boolean().optional(),
});
export type AgentHistoryReadWireOptions = z.infer<typeof AgentHistoryReadWireOptionsSchema>;

/** Envelope payload: a discriminated union keyed by `kind`. */
export const WirePayloadSchema = z.discriminatedUnion('kind', [
  // ── Session control ──
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

  // ── Historical sessions ──
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

  // ── Host configuration (daemon-owned provider config) ──
  z.object({ kind: z.literal('config.get'), clientReqId: z.string().min(1) }),
  z.object({
    kind: z.literal('config.get.result'),
    replyTo: z.string().min(1),
    providers: ProvidersConfigSchema,
  }),
  z.object({
    kind: z.literal('config.set'),
    clientReqId: z.string().min(1),
    providers: ProvidersConfigSchema,
  }),

  // ── Workspaces (registered directories, see workspace.ts) ──
  z.object({ kind: z.literal('workspace.list'), clientReqId: z.string().min(1) }),
  z.object({
    kind: z.literal('workspace.listed'),
    replyTo: z.string().min(1),
    workspaces: z.array(WorkspaceRecordSchema),
  }),
  z.object({
    kind: z.literal('workspace.register'),
    clientReqId: z.string().min(1),
    cwd: z.string().min(1),
    name: z.string().min(1).optional(),
    /** Omitted by every current call site (the daemon defaults to `'project'`); see workspace.ts. */
    workspaceKind: WorkspaceKindSchema.optional(),
  }),
  z.object({
    kind: z.literal('workspace.registered'),
    replyTo: z.string().min(1),
    record: WorkspaceRecordSchema,
  }),
  z.object({
    kind: z.literal('workspace.update'),
    clientReqId: z.string().min(1),
    workspaceId: WorkspaceIdSchema,
    name: z.string().min(1),
  }),
  z.object({
    kind: z.literal('workspace.archive'),
    clientReqId: z.string().min(1),
    workspaceId: WorkspaceIdSchema,
  }),

  // ── Git (directory-backed: keyed by cwd, shared by same-cwd sessions — see git.ts) ──
  z.object({
    kind: z.literal('git.status.get'),
    clientReqId: z.string().min(1),
    cwd: z.string().min(1),
  }),
  z.object({
    kind: z.literal('git.status.get.result'),
    replyTo: z.string().min(1),
    status: GitStatusSchema,
  }),
  z.object({
    kind: z.literal('git.pr_status.get'),
    clientReqId: z.string().min(1),
    cwd: z.string().min(1),
  }),
  z.object({
    kind: z.literal('git.pr_status.get.result'),
    replyTo: z.string().min(1),
    prStatus: GitPullRequestStatusSchema,
  }),
  z.object({
    kind: z.literal('git.diff.get'),
    clientReqId: z.string().min(1),
    cwd: z.string().min(1),
    mode: GitDiffModeSchema,
  }),
  z.object({
    kind: z.literal('git.diff.get.result'),
    replyTo: z.string().min(1),
    diff: GitDiffSchema,
  }),

  // ── Data plane ──
  z.object({
    kind: z.literal('agent.input'),
    clientReqId: z.string().min(1),
    sessionId: SessionIdSchema,
    input: AgentInputSchema,
  }),
  z.object({ kind: z.literal('agent.event'), sessionId: SessionIdSchema, event: AgentEventSchema }),

  // ── Terminals (data plane) ──
  // Interactive PTYs the host owns; bytes travel as UTF-8 strings (host-side streaming decode keeps
  // the JSON wire base64-free). `open` is request/reply (clientReqId → replyTo); input/resize/close are
  // fire-and-forget so keystrokes never pay a round-trip; output/exit broadcast like `agent.event`.
  z.object({
    kind: z.literal('terminal.open'),
    clientReqId: z.string().min(1),
    opts: z.object({
      // Capped at the sidecar's u16 winsize range; an out-of-range value would overflow its
      // deserialize and tear down the whole PTY host, so reject it at the wire boundary.
      cols: z.number().int().positive().max(0xFFFF),
      rows: z.number().int().positive().max(0xFFFF),
      cwd: z.string().optional(),
      shell: z.string().optional(),
      // Present for agent-owned terminals so the host can reap them when the session stops.
      sessionId: SessionIdSchema.optional(),
    }),
  }),
  z.object({
    kind: z.literal('terminal.opened'),
    replyTo: z.string().min(1),
    terminalId: z.string().min(1),
  }),
  z.object({ kind: z.literal('terminal.input'), terminalId: z.string().min(1), data: z.string() }),
  z.object({
    kind: z.literal('terminal.resize'),
    terminalId: z.string().min(1),
    cols: z.number().int().positive().max(0xFFFF),
    rows: z.number().int().positive().max(0xFFFF),
  }),
  z.object({ kind: z.literal('terminal.close'), terminalId: z.string().min(1) }),
  z.object({ kind: z.literal('terminal.output'), terminalId: z.string().min(1), data: z.string() }),
  z.object({
    kind: z.literal('terminal.exit'),
    terminalId: z.string().min(1),
    // null when the shell was terminated by a signal rather than exiting with a code.
    exitCode: z.number().int().nullable(),
  }),

  // ── Keep-alive ──
  z.object({ kind: z.literal('ping') }),
  z.object({ kind: z.literal('pong') }),
]);
export type WirePayload = z.infer<typeof WirePayloadSchema>;

/** Complete wire message: version + unique id + timestamp + payload. */
export const WireMessageSchema = z.object({
  v: z.literal(WIRE_PROTOCOL_VERSION),
  id: MessageIdSchema,
  ts: TimestampSchema,
  payload: WirePayloadSchema,
});
export type WireMessage = z.infer<typeof WireMessageSchema>;

/** Parse + validate an inbound message; on failure returns the zod SafeParse result. */
export function parseWireMessage(input: unknown): ReturnType<typeof WireMessageSchema.safeParse> {
  return WireMessageSchema.safeParse(input);
}
