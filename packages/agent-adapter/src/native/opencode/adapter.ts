import { realpath } from 'node:fs/promises';
import { parse, sep } from 'node:path';
import type {
  AgentCommand,
  AgentHistoryCapabilities,
  AgentHistoryListOptions,
  AgentHistoryListResult,
  AgentHistoryReadOptions,
  AgentHistoryReadResult,
  AgentHistoryResumeOptions,
  ApprovalPolicy,
  ContentBlock,
  PermissionOption,
  Question,
  StartOptions,
} from '@linkcode/schema';
import type { Event, FilePartInput, Part, TextPartInput } from '@opencode-ai/sdk/v2';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { invariant } from 'foxts/guard';
import { falseFn } from 'foxts/noop';
import { AUTH_FAILED_ERROR_CODE, nextToolCallId } from '../../adapter';
import { BaseAgentAdapter } from '../../base';
import { readAgentCredential } from '../../credential';
import { asHistoryId, boundedLimit, cursorFromTotal, cursorOffset } from '../../history-util';
import { contentToText, imageBlocksFrom, toolKindFromName } from '../../util';
import {
  filterRevertedMessages,
  mapOpencodeHistoryEvents,
  opencodeSessionToHistorySession,
  toolCallFromPart,
} from './history';
import type { OpencodeHistoryServerLike } from './history-server';
import { sharedOpencodeHistoryServer } from './history-server';

type PermissionAsked = Extract<Event, { type: 'permission.asked' }>['properties'];
type QuestionAsked = Extract<Event, { type: 'question.asked' }>['properties'];
type SessionErrored = Extract<Event, { type: 'session.error' }>['properties'];

/** Same three-way menu as claude-code's tool asks; `allow_always` maps onto opencode's `always`
 * reply, which the server persists as a saved allow rule for the ask's matched pattern. */
const PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
  { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
];

/** Cap on how long `onCancel` waits for `session.abort`: opencode has blocked the abort RPC until
 * the running tool actually exits (tens of seconds, observed on 1.14.42+ by paseo; 1.17.11 returns
 * in ~30ms). Past the cap the local cancel proceeds while the abort settles server-side. */
const ABORT_WAIT_MS = 2000;
const ABORT_TIMED_OUT = Symbol('opencode-abort-timeout');

/** Most `session.error` variants carry `data.message`; fall back to the variant name. */
function sessionErrorMessage(error: NonNullable<SessionErrored['error']>): string {
  const message = (error.data as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' && message.length > 0 ? message : error.name;
}

/** opencode records server-canonical (symlink-resolved) directories; the caller's cwd may arrive
 * through a symlink (macOS `/tmp` → `/private/tmp`) or with a trailing separator — resolve it the
 * same way or matching sessions silently vanish from the cwd-filtered list. */
async function canonicalDirectory(cwd: string): Promise<string> {
  // Roots keep their separator: stripping '/' or Windows 'C:\' would change meaning ('C:' is
  // "current directory on drive C", not the drive root).
  const trimmed = cwd.endsWith(sep) && cwd !== parse(cwd).root ? cwd.slice(0, -1) : cwd;
  try {
    return await realpath(trimmed);
  } catch {
    return trimmed;
  }
}

/** The generated client resolves with `{error}` on HTTP and network failures alike (nothing here
 * passes `throwOnError`), so every RPC result must be checked — an unchecked failure silently
 * reads as success. Throws with the error detail when the result carries one. */
function okOrThrow<T extends { error?: unknown }>(result: T, context: string): T {
  if (result.error === undefined) return result;
  let detail: string;
  if (typeof result.error === 'string') {
    detail = result.error;
  } else {
    try {
      detail = JSON.stringify(result.error) ?? 'unknown error';
    } catch {
      detail = extractErrorMessage(result.error) ?? 'unknown error';
    }
  }
  throw new Error(`${context} failed: ${detail}`);
}

/** Split a `providerID/modelID` model string; undefined for anything else — opencode model refs
 * are always provider-scoped, a bare id has no provider to route by. */
function parseModelRef(model: string): { providerID: string; modelID: string } | undefined {
  const [providerID, ...rest] = model.split('/');
  const modelID = rest.join('/');
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

type OpencodeModule = typeof import('@opencode-ai/sdk/v2');
type OpencodeClient = Awaited<ReturnType<OpencodeModule['createOpencode']>>['client'];

/**
 * OpenCode adapter — the server/client model. `createOpencode()` spawns a local OpenCode server and returns
 * an HTTP client; we own that server's lifecycle. A prompt is sent with `session.prompt`, and the response
 * streams back over the SSE `event.subscribe()` stream (filtered to our session).
 */
export class OpenCodeAdapter extends BaseAgentAdapter {
  readonly kind = 'opencode' as const;
  override readonly capabilities = { slashCommands: true, shellCommand: true } as const;
  override readonly historyCapabilities: AgentHistoryCapabilities = {
    list: true,
    read: true,
    resume: true,
  };

  private client: OpencodeClient | null = null;
  private closeServer: (() => void) | null = null;
  private sessionId: string | null = null;
  /** Provider session id to adopt at the next start — set by `resumeHistory`. OpenCode sessions
   * live server-side, so a native resume is just prompting the existing id again. */
  private resumeFrom: string | null = null;
  /** Directory scope for every session-bound RPC and the event subscription: the session's own
   * home. Equal to `opts.cwd` for fresh sessions; a resumed session keeps the (server-canonical)
   * directory it was created under, which the resume's `startOpts.cwd` need not match — and a
   * mismatched scope silently misses every event on the per-directory instance bus. */
  private directory: string | undefined;
  private stopped = false;
  /** True while a turn is in flight (prompt sent, `session.idle` not yet seen) — gates whether the
   * event stream ending is an unexpected failure or an expected side effect of the turn finishing. */
  private turnActive = false;
  /** True once `onCancel` has aborted the in-flight turn — any stream fallout until the next prompt
   * (thrown or clean) is that abort's expected side effect, not a failure. */
  private cancelling = false;
  /** True once a `session.error` failed the active turn — the idle settle then skips the `end_turn`
   * stop (the error event already told the story) and sweeps unsettled tools. */
  private turnFailed = false;
  /** True once the server acknowledged the active turn on-stream (`session.status` busy/retry).
   * A turn's own `session.error` and `session.idle` NEVER precede its busy status (verified live
   * on 1.17.11), so an idle or error arriving before it is the PREVIOUS turn's documented
   * post-settle straggler (the duplicate idle an abort produces; the error re-fired with a stack
   * after the settle) and must not touch this turn. */
  private turnStarted = false;
  /** Monotonic flag-ownership counter, bumped by every prompt AND every cancel — lets a straggling
   * abort settlement from an earlier cancel know whether it may still clear `cancelling` (a newer
   * prompt or a repeat cancel owns the flags by then). */
  private turnEpoch = 0;
  /** Announced tool part id by provider `callID`: permission/question asks cite the tool they gate
   * via `tool.callID`, but the tool card was announced under the PART id — this map re-joins them
   * so the ask lands on the visible card. Cleared at each turn settle. */
  private readonly toolPartIdByCallId = new Map<string, string>();
  /** Message ids opencode reported with `role: 'user'` — their parts must be skipped: the server
   * streams `message.part.updated` for the user's own prompt text too (observed live on 1.17.11;
   * `message.updated {role:'user'}` precedes its parts), and replaying that text would
   * double-render the prompt as an agent bubble. Cleared at each turn settle. */
  private readonly userMessageIds = new Set<string>();
  /** Provider the spawn-time credential injection scoped to (null = nothing injected): the only
   * provider a mid-session set-model may target while a per-account credential is in play. */
  private credentialProviderId: string | null = null;
  /** The opencode agent (build/plan/custom) surfaced as the approval-policy axis (CODE-224): the
   * pick rides every subsequent prompt/command as the `agent` field — next-turn semantics, an
   * in-flight turn keeps the agent it started with. Null until `adoptAgentCatalog` resolves. */
  private currentAgent: string | null = null;
  /** Selectable agents advertised as approval policies — empty when discovery failed or returned
   * nothing, which keeps the axis hidden client-side (empty list = no selector, see schema). */
  private agentPolicies: ApprovalPolicy[] = [];

  protected async onStart(opts: StartOptions): Promise<void> {
    const mod = await this.loadSdk('@opencode-ai/sdk', () => import('@opencode-ai/sdk/v2'));
    let started: Awaited<ReturnType<OpencodeModule['createOpencode']>>;
    // OpenCode routes by provider; inject the account's key + base URL under the model's provider id
    // (the `providerID` half of `providerID/modelID`) so the spawned server authenticates and, for a
    // gateway account, targets that provider.
    const cred = readAgentCredential(opts.config);
    const providerID = opts.model?.includes('/') ? opts.model.split('/', 1)[0] : undefined;
    const options: { apiKey?: string; baseURL?: string } = {};
    const key = cred.apiKey ?? cred.authToken;
    if (key) options.apiKey = key;
    if (cred.baseUrl) options.baseURL = cred.baseUrl;
    const serverOptions =
      providerID && (options.apiKey || options.baseURL)
        ? { config: { provider: { [providerID]: { options } } } }
        : undefined;
    // The injection is spawn-time-only: remember which provider it scoped to so a later
    // set-model can refuse a cross-provider switch the running server holds no credentials for.
    this.credentialProviderId = serverOptions ? (providerID ?? null) : null;
    try {
      started = await mod.createOpencode(serverOptions);
    } catch (err) {
      const detail = extractErrorMessage(err) ?? 'Unknown error';
      this.emitError(`opencode: failed to start server (${detail})`, 'sdk-unavailable', false);
      throw new Error(detail, { cause: err });
    }
    this.client = started.client;
    this.closeServer = () => started.server.close();
    let resumedAgent: string | null = null;
    if (this.resumeFrom) {
      // Adopt the existing provider session instead of creating one, and announce its id right
      // away — a resumed session's transcript is real, so the seed read is safe immediately
      // (unlike the fresh path below).
      const got = await this.client.session.get({ sessionID: this.resumeFrom });
      if (got.error !== undefined || !got.data) {
        throw new Error(`opencode: history '${this.resumeFrom}' was not found`);
      }
      this.sessionId = got.data.id;
      this.directory = got.data.directory;
      // A resumed session continues under its recorded control state unless the caller overrode
      // it: the Session record tracks the last-used model/agent (live-verified on 1.18.2 — both
      // fields update after every turn), so the next turn resends what the session last ran with.
      if (!opts.model && got.data.model) {
        opts.model = `${got.data.model.providerID}/${got.data.model.id}`;
      }
      resumedAgent = got.data.agent ?? null;
      this.emitSessionRef(asHistoryId(got.data.id));
    } else {
      const created = okOrThrow(
        await this.client.session.create({ directory: opts.cwd }),
        'opencode: session.create',
      );
      const id = created.data?.id;
      if (!id) throw new Error('opencode: failed to create session');
      this.sessionId = id;
      this.directory = opts.cwd;
    }
    // Both catalog fetches are best-effort: neither has an SSE change event (poll-only), and a
    // failed list must not fail session start — absence is itself the capability signal (no
    // `available-commands-update` / approval-policy state ever fires for this session). They are
    // independent reads of the same local server, so they run concurrently.
    await Promise.all([this.fetchCommandCatalog(), this.fetchAgentCatalog(resumedAgent)]);
    // Reflect the model the session will prompt with (configured, or adopted from the resumed
    // session above) so the client chip is right before the first turn.
    if (opts.model) this.emitModel(opts.model);
    void this.consumeEvents();
  }

  /** Best-effort slash-command catalog fetch — swallows every failure (see `onStart`). */
  private async fetchCommandCatalog(): Promise<void> {
    if (!this.client) return;
    try {
      const listed = await this.client.command.list({ directory: this.directory });
      if (listed.error === undefined && listed.data.length > 0) {
        this.emitCommands(
          listed.data.map(
            (c): AgentCommand => ({
              name: c.name,
              description: c.description,
              argumentHint: c.hints.join(' ') || undefined,
            }),
          ),
        );
      }
    } catch {
      // Non-fatal — see onStart.
    }
  }

  /** Best-effort agent catalog fetch — swallows every failure (see `onStart`). */
  private async fetchAgentCatalog(resumedAgent: string | null): Promise<void> {
    if (!this.client) return;
    try {
      const agents = await this.client.app.agents({ directory: this.directory });
      if (agents.error === undefined) this.adoptAgentCatalog(agents.data, resumedAgent);
    } catch {
      // Non-fatal — see onStart.
    }
  }

  /** Turn-state setup shared by every turn-initiating input (prompt / command / shell command):
   * bumps the epoch, arms the turn-liveness flags, and announces `running`. Returns the epoch so a
   * fire-and-not-await RPC failure can check it still owns the turn before touching it. */
  private beginTurn(): number {
    if (this.turnActive || this.cancelling) {
      throw new Error('opencode: session is busy');
    }
    this.turnEpoch += 1;
    this.turnActive = true;
    this.turnStarted = false;
    this.cancelling = false;
    this.turnFailed = false;
    this.emitStatus('running');
    return this.turnEpoch;
  }

  protected async onPrompt(content: ContentBlock[]): Promise<void> {
    if (!this.client || !this.sessionId) throw new Error('opencode: session not started');
    const parts: Array<TextPartInput | FilePartInput> = [
      { type: 'text', text: contentToText(content) },
      ...imageBlocksFrom(content).map(
        (image): FilePartInput => ({
          type: 'file',
          mime: image.mimeType,
          url: `data:${image.mimeType};base64,${image.data}`,
        }),
      ),
    ];
    this.beginTurn();
    // promptAsync, not prompt: the blocking variant's HTTP response only resolves once the whole
    // turn finishes, which would hold send() open for the turn's full duration and risks HTTP-layer
    // timeouts on long turns. The SSE stream is the single source of turn lifecycle either way.
    const result = await this.client.session.promptAsync({
      sessionID: this.sessionId,
      directory: this.directory,
      model: this.model(),
      agent: this.currentAgent ?? undefined,
      parts,
    });
    if (result.error !== undefined) {
      // The turn never started; put the session back to rest before rejecting send().
      this.turnActive = false;
      this.emitStatus('idle');
      okOrThrow(result, 'opencode: session.promptAsync');
    }
  }

  /** Invoke a provider slash command (catalog announced at `onStart`). Executing a command runs the
   * exact same internal turn as a prompt (the server expands the template and feeds it through the
   * same model loop) — same SSE lifecycle, so the turn-state setup mirrors `onPrompt` exactly. Fires
   * `session.command` without awaiting its HTTP response: that response only resolves once the whole
   * turn finishes, and the SSE stream (session.status busy / message parts / session.idle) is the
   * turn's real settle signal either way. */
  protected override onCommand(name: string, args?: string): Promise<void> {
    if (!this.client || !this.sessionId) throw new Error('opencode: session not started');
    const epoch = this.beginTurn();
    void this.client.session
      .command({
        sessionID: this.sessionId,
        directory: this.directory,
        command: name,
        arguments: args ?? '',
        model: this.opts?.model,
        agent: this.currentAgent ?? undefined,
      })
      .then((result) => {
        if (result.error === undefined) return;
        // A newer turn (a later command/prompt/shell, or a cancel) already owns the flags by the
        // time this settles — this failure belongs to a superseded turn and must not touch it.
        if (this.turnEpoch !== epoch) return;
        // The turn never actually started server-side (same as an immediate promptAsync failure):
        // put the session back to rest and surface the failure. Nothing was fire-and-awaited here,
        // so there is no rejected send() to carry the error — emit it instead.
        this.turnActive = false;
        try {
          okOrThrow(result, 'opencode: session.command');
        } catch (err) {
          this.emitError(extractErrorMessage(err) ?? 'opencode: session.command failed');
        }
        this.emitStatus('idle');
      });
    return Promise.resolve();
  }

  /** Run a raw shell command outside the model loop. Upstream, `session.shell` does NOT call the
   * model: it synthesizes a user + assistant message and streams the subprocess output through the
   * same part machinery as a real turn, toggling the session busy/idle run-state the same way (both
   * upstream-verified) — so the turn-state setup mirrors `onPrompt` and the SSE stream is expected to
   * drive rendering and settle. Fire-and-not-await for the same reason as `onCommand`, plus a settle
   * backstop below: the HTTP response only resolves once the subprocess exits, and whether
   * `session.status` busy/idle actually fires for shell turns (as opposed to only for model turns) is
   * the one bit this hasn't been verified live for. */
  protected override async onShellCommand(command: string): Promise<void> {
    if (!this.client || !this.sessionId) throw new Error('opencode: session not started');
    const agent = await this.resolveShellAgent();
    const epoch = this.beginTurn();
    void this.client.session
      .shell({
        sessionID: this.sessionId,
        directory: this.directory,
        agent,
        command,
      })
      .then((result) => {
        // A newer turn already owns the flags by the time this settles — same rule as `onCommand`.
        if (this.turnEpoch !== epoch) return;
        if (result.error !== undefined) {
          this.turnActive = false;
          try {
            okOrThrow(result, 'opencode: session.shell');
          } catch (err) {
            this.emitError(extractErrorMessage(err) ?? 'opencode: session.shell failed');
          }
          this.emitStatus('idle');
          return;
        }
        // Belt-and-braces backstop: if the turn is still active (no `session.idle` settled it via
        // the stream by the time the subprocess-bound response came back), force the settle rather
        // than leave it hanging at `running`.
        if (this.turnActive) this.settleTurn(true);
      });
  }

  /** Resolves the agent name `session.shell` runs under: the session's currently selected agent
   * (the approval-policy pick), mirroring the upstream TUI's own shell dispatch under the current
   * primary agent. When the start-time catalog fetch failed, retry it here — a late success also
   * re-arms the approval-policy axis (`adoptAgentCatalog` emits the state). Bottoms out at
   * `'build'`, opencode's config-defined default primary agent (not a protocol constant). */
  private async resolveShellAgent(): Promise<string> {
    if (!this.currentAgent) await this.fetchAgentCatalog(null);
    return this.currentAgent ?? 'build';
  }

  protected override async onCancel(): Promise<void> {
    this.turnActive = false;
    this.cancelling = true;
    // A repeat cancel takes over the flags: without the bump, the FIRST cancel's straggling abort
    // could fail late and clear the latch this cancel now owns, making the second abort's real
    // fallout read as a genuine stream failure.
    this.turnEpoch += 1;
    // Captured NOW, not when the wait cap fires: a repeat cancel inside the wait window must not
    // let this cancel's late-failure watcher mistake itself for the current flag owner.
    const epoch = this.turnEpoch;
    if (!this.client || !this.sessionId) return;
    const abort = this.client.session.abort({
      sessionID: this.sessionId,
      directory: this.directory,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raced = await Promise.race([
        abort,
        new Promise<typeof ABORT_TIMED_OUT>((resolve) => {
          timer = setTimeout(() => resolve(ABORT_TIMED_OUT), ABORT_WAIT_MS);
        }),
      ]);
      if (raced === ABORT_TIMED_OUT) {
        // The abort RPC is still in flight server-side (see ABORT_WAIT_MS): proceed with the local
        // cancel and leave `cancelling` latched — the abort's fallout (`session.error` aborted +
        // `session.idle`) is still expected. But if the straggling abort ultimately FAILS, no
        // fallout is coming; clear the latch (unless a newer prompt or cancel owns the flags by
        // then) so a later genuine stream failure isn't swallowed as this cancel's fallout.
        void abort
          .then((res) => res.error === undefined)
          .catch(falseFn)
          .then((cleanAbort) => {
            // A clean success leaves the latch for the expected fallout; any failure (rejected or
            // resolved-with-error) means no fallout is coming, so clear the latch — unless a newer
            // prompt or cancel already owns the flags by then.
            if (!cleanAbort && this.turnEpoch === epoch) this.cancelling = false;
          });
        return;
      }
      okOrThrow(raced, 'opencode: session.abort');
    } catch (err) {
      // The abort itself failed, so no cancel-induced idle/close is coming to reset the flag.
      // Leaving `cancelling` latched would make `consumeEvents()` swallow a later genuine stream
      // failure as an expected cancel close — clear it here so only a real cancel suppresses.
      this.cancelling = false;
      throw err;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  protected override onStop(): Promise<void> {
    this.stopped = true;
    this.closeServer?.();
    return Promise.resolve();
  }

  override async resumeHistory(
    opts: AgentHistoryResumeOptions,
    startOpts: StartOptions,
  ): Promise<void> {
    this.resumeFrom = opts.historyId;
    await this.start(startOpts);
  }

  override async listHistory(opts?: AgentHistoryListOptions): Promise<AgentHistoryListResult> {
    const offset = cursorOffset(opts?.cursor);
    const limit = boundedLimit(opts?.limit, 50, 200);
    const cwdFilter = opts?.cwd ? await canonicalDirectory(opts.cwd) : undefined;
    const sessions = await this.withHistoryClient(async (client) => {
      // `roots` excludes subagent child sessions; the neutral-cwd shared server lists sessions
      // across every project without directory scoping (verified live on 1.17.11).
      const listed = okOrThrow(
        await client.session.list({ roots: true }),
        'opencode: session.list',
      );
      return (listed.data ?? [])
        .filter(
          (session) =>
            session.time.archived === undefined &&
            !session.parentID &&
            (!cwdFilter || session.directory === cwdFilter),
        )
        .sort((a, b) => b.time.updated - a.time.updated)
        .map(opencodeSessionToHistorySession);
    });
    return {
      sessions: sessions.slice(offset, offset + limit),
      cursor: cursorFromTotal(offset, sessions.length, limit),
    };
  }

  override async readHistory(opts: AgentHistoryReadOptions): Promise<AgentHistoryReadResult> {
    const offset = cursorOffset(opts.cursor);
    const limit = boundedLimit(opts.limit, 1000, 1000);
    const { session, events } = await this.withHistoryClient(async (client) => {
      // `get` (revert marker + summary) and the full message fetch are independent — one round
      // trip of latency instead of two; existence is judged off `get` once both land. The full
      // fetch + event-level slicing is the codex contract, and unavoidable here: the messages
      // RPC's own `limit` returns the LAST n messages, not the first n (verified live on
      // 1.17.11), so it cannot implement forward pagination.
      const [got, messages] = await Promise.all([
        client.session.get({ sessionID: opts.historyId }),
        client.session.messages({ sessionID: opts.historyId }),
      ]);
      if (got.error !== undefined || !got.data) {
        throw new Error(`opencode: history '${opts.historyId}' was not found`);
      }
      okOrThrow(messages, 'opencode: session.messages');
      return {
        session: opencodeSessionToHistorySession(got.data),
        events: mapOpencodeHistoryEvents(
          opts.historyId,
          filterRevertedMessages(messages.data ?? [], got.data.revert),
        ),
      };
    });
    return {
      session,
      events: events.slice(offset, offset + limit),
      cursor: cursorFromTotal(offset, events.length, limit),
    };
  }

  /** Test seam — the real thing is the process-wide shared history server (CODE-171). */
  protected historyServer(): OpencodeHistoryServerLike {
    return sharedOpencodeHistoryServer();
  }

  private async withHistoryClient<T>(fn: (client: OpencodeClient) => Promise<T>): Promise<T> {
    // Plain import, not loadSdk: history calls run on never-started adapter instances
    // (HistoryService constructs one per call via the factory) where the sdk-unavailable error
    // event has no listeners — the rejection reaching HistoryService is the whole story.
    const mod = await import('@opencode-ai/sdk/v2');
    return this.historyServer().withServer((baseUrl) => fn(mod.createOpencodeClient({ baseUrl })));
  }

  /** Model switching (CODE-224): stored and resent on the next `session.promptAsync` /
   * `session.command` — `model()` re-derives from `opts.model` fresh every turn, so this is a
   * pure store-then-emit like codex. Next-turn semantics; nothing can alter an in-flight turn.
   * Live-verified on binary 1.18.2 × SDK 1.17.18: a mid-session model change routes the very
   * next turn (assistant `providerID`/`modelID` readback), and no switched/ack event fires on
   * the legacy bus — the immediate reflect below is the only confirmation channel there is. */
  protected override onSetModel(model: string): Promise<void> {
    invariant(this.opts, 'opencode: session not started');
    const parsed = parseModelRef(model);
    if (!parsed) {
      // Storing an unparseable ref would emit a "successful" model-update while every following
      // prompt silently omits the model field and keeps running on the previous one.
      return Promise.reject(
        new Error(`opencode: model must be 'providerID/modelID' (got '${model}')`),
      );
    }
    // The per-account credential is injected for exactly one provider at server spawn; the
    // running server holds no credentials for any other, so a cross-provider switch would strand
    // the next turn on an auth failure after the UI already reported the switch as successful.
    if (this.credentialProviderId && parsed.providerID !== this.credentialProviderId) {
      return Promise.reject(
        new Error(
          `opencode: the session's server holds credentials for '${this.credentialProviderId}' only — start a new session to use provider '${parsed.providerID}'`,
        ),
      );
    }
    this.opts.model = model;
    // Reflect the pick now; it applies from the next prompt.
    this.emitModel(model);
    return Promise.resolve();
  }

  /** Approval-policy axis = opencode's agent axis (CODE-224): the selectable agents advertised by
   * `adoptAgentCatalog` are the policies, and the pick rides the next prompt/command as the
   * `agent` field. The permission posture itself stays config-driven (CODE-136) — this axis picks
   * which agent persona (each carrying its own permission ruleset, e.g. read-only `plan`) runs
   * the following turns. Live-verified on binary 1.18.2 × SDK 1.17.18: a mid-session `agent`
   * change applies to the very next turn (assistant `agent`/`mode` readback both flip). */
  protected override onSetApprovalPolicy(policyId: string): Promise<void> {
    if (!this.agentPolicies.some((policy) => policy.policyId === policyId)) {
      return Promise.reject(new Error(`opencode: unknown approval policy '${policyId}'`));
    }
    this.currentAgent = policyId;
    this.emitApprovalPolicy({ availablePolicies: this.agentPolicies, currentPolicyId: policyId });
    return Promise.resolve();
  }

  /** Surface opencode's selectable agents (`primary`/`all`, non-hidden — subagents are spawn
   * targets, not personas a user runs a turn under) as the approval-policy axis. Default mirrors
   * the upstream TUI: the first primary agent, else the first selectable; a resumed session's
   * recorded agent wins while it is still selectable. Nothing selectable → the axis stays hidden
   * (an empty `availablePolicies` is never emitted). */
  private adoptAgentCatalog(
    agents: ReadonlyArray<{ name: string; mode: string; hidden?: boolean; description?: string }>,
    resumedAgent: string | null,
  ): void {
    const selectable = agents.filter(
      (agent) => (agent.mode === 'primary' || agent.mode === 'all') && agent.hidden !== true,
    );
    const fallback = selectable.find((agent) => agent.mode === 'primary') ?? selectable.at(0);
    if (!fallback) return;
    const current =
      resumedAgent && selectable.some((agent) => agent.name === resumedAgent)
        ? resumedAgent
        : fallback.name;
    this.currentAgent = current;
    this.agentPolicies = selectable.map((agent) => ({
      policyId: agent.name,
      name: agent.name.charAt(0).toUpperCase() + agent.name.slice(1),
      ...(agent.description && { description: agent.description }),
    }));
    this.emitApprovalPolicy({ availablePolicies: this.agentPolicies, currentPolicyId: current });
  }

  private model(): { providerID: string; modelID: string } | undefined {
    return this.opts?.model ? parseModelRef(this.opts.model) : undefined;
  }

  /** Runs for the whole session, dispatching every SSE event the OpenCode server pushes over the
   * single long-lived `event.subscribe()` stream (subscribed once in `onStart`). Only returns when
   * that stream ends — `subscribe()` rejecting up front, the iterator throwing mid-stream, or the
   * server just closing it.
   *
   * Not every ending is a failure: a turn finishing normally (`session.idle`) closes the stream just
   * like a genuine disconnect would, and so does our own `cancel` aborting the turn — neither should
   * be reported as an error. Only a clean close while a turn is still active (not idle, not
   * cancelled), or the iterator itself throwing outside of a cancel, is a real, unexpected failure. */
  private async consumeEvents(): Promise<void> {
    if (!this.client) return;
    let caught: unknown;
    try {
      // Events are scoped to the per-directory instance: a bare subscribe() only carries the
      // server-cwd instance's bus and silently misses every session event whenever the daemon cwd
      // differs from the session cwd (verified live on opencode 1.17.11).
      const sub = await this.client.event.subscribe({ directory: this.directory });
      for await (const ev of sub.stream) {
        if (this.stopped) break;
        this.handleEvent(ev);
      }
    } catch (err) {
      caught = err;
    }
    if (this.stopped || this.cancelling) return;
    // Clean close with no turn in flight (already idle, or never started one) is expected —
    // nothing was interrupted.
    if (!caught && !this.turnActive) return;
    // Nothing resubscribes today (see CODE-9), so this session can no longer receive events.
    // Sweep in-flight state and surface it as fatal — `stopped`, not `idle`, so the UI disables
    // the composer instead of treating this session as still usable.
    this.teardown();
    this.emitError(
      caught
        ? (extractErrorMessage(caught) ?? 'opencode: event stream failed')
        : 'opencode: event stream ended unexpectedly',
      undefined,
      false,
    );
    this.emitStatus('stopped');
  }

  /** Each event is handled in its own try/catch so one malformed event (e.g. an unexpected
   * `properties`/`part` shape) reports an error without ending the whole stream. */
  private handleEvent(ev: Event): void {
    try {
      switch (ev.type) {
        case 'message.updated':
          if (ev.properties.sessionID === this.sessionId && ev.properties.info.role === 'user') {
            this.userMessageIds.add(ev.properties.info.id);
          }
          break;
        case 'message.part.updated':
          if (
            ev.properties.sessionID === this.sessionId &&
            !this.userMessageIds.has(ev.properties.part.messageID)
          ) {
            this.handlePart(ev.properties.part);
          }
          break;
        case 'permission.asked':
          if (ev.properties.sessionID === this.sessionId) {
            void this.handlePermissionAsked(ev.properties).catch((err: unknown) => {
              this.emitError(extractErrorMessage(err) ?? 'opencode: permission reply failed');
            });
          }
          break;
        case 'question.asked':
          if (ev.properties.sessionID === this.sessionId) {
            void this.handleQuestionAsked(ev.properties).catch((err: unknown) => {
              this.emitError(extractErrorMessage(err) ?? 'opencode: question reply failed');
            });
          }
          break;
        case 'session.status':
          // busy/retry is the server's on-stream acknowledgement that the active turn is running —
          // the marker that lets settle/error handling tell this turn's events from the previous
          // turn's post-settle stragglers.
          if (
            ev.properties.sessionID === this.sessionId &&
            this.turnActive &&
            ev.properties.status.type !== 'idle'
          ) {
            this.turnStarted = true;
            // First on-stream acknowledgement of a turn: safe to announce the provider-local id
            // now. Announcing at session.create would trigger the client's transcript seed
            // against an empty session, and the seed's uptoSeq cut would swallow the first
            // prompt (codex defers fresh-thread session-ref for the same reason). Re-announces
            // dedupe in the base class.
            this.emitSessionRef(asHistoryId(this.sessionId));
          }
          break;
        case 'session.error':
          // sessionID is OPTIONAL on this event (unlike every other event handled here); this
          // adapter owns its whole server, so an unattributed error is ours — e.g. an auth failure
          // must still reach the AUTH_FAILED_ERROR_CODE path.
          if (ev.properties.sessionID === undefined || ev.properties.sessionID === this.sessionId) {
            this.handleSessionError(ev.properties);
          }
          break;
        case 'session.idle':
          if (ev.properties.sessionID === this.sessionId) this.settleTurn();
          break;
        default:
          break;
      }
    } catch (err) {
      this.emitError(extractErrorMessage(err) ?? `opencode: failed to handle event (${ev.type})`);
    }
  }

  /** Turn settle on `session.idle`. Guarded on turn liveness AND the on-stream turn-start marker:
   * opencode emits a duplicate idle after an abort (observed live: error → idle → idle), and that
   * straggler can land after the NEXT prompt was already dispatched — without the `turnStarted`
   * gate it would falsely settle the new turn and then swallow its real settle.
   *
   * `force` bypasses that gate: it's the shell-command settle backstop's escape hatch for the one
   * unverified bit — whether `session.status` busy (and so `turnStarted`) fires for shell turns at
   * all — so a turn that legitimately finished without ever setting `turnStarted` still settles
   * instead of hanging at `running`. */
  private settleTurn(force = false): void {
    const started = force || (this.turnActive && this.turnStarted);
    if (!started && !this.cancelling && !this.turnFailed) {
      if (this.turnActive) {
        // Normally the previous turn's post-settle straggler. But if the server never emits
        // `session.status` (the busy-precedes-idle ordering is only live-verified on 1.17.11),
        // this WAS the real settle and the turn will hang at `running` — leave a trace so a
        // stuck turn is attributable.
        console.warn(
          'opencode: absorbed a session.idle that preceded the busy acknowledgement (straggler, or a server that never emits session.status)',
        );
      }
      return;
    }
    const cancelled = this.cancelling;
    const failed = this.turnFailed;
    this.turnActive = false;
    this.cancelling = false;
    this.turnFailed = false;
    this.toolPartIdByCallId.clear();
    this.userMessageIds.clear();
    // A cancelled or failed turn never delivers its remaining tool settles; sweep them (idempotent
    // after the base cancel-path teardown).
    if (cancelled || failed) this.teardown();
    if (cancelled) this.emitStop('cancelled');
    else if (!failed) this.emitStop('end_turn');
    this.emitStatus('idle');
  }

  /** `session.error` arrives both mid-turn (failing it) and as a post-idle duplicate (observed
   * live: the same failure re-emitted with a stack trace after the settle) — and that duplicate
   * can land after the NEXT prompt was dispatched. A turn's own error never precedes its busy
   * status (verified live), so gating on `turnStarted` keeps stragglers from poisoning the new
   * turn. `session.idle` still follows every error and does the settle. */
  private handleSessionError(props: SessionErrored): void {
    const error = props.error;
    if (!error) return;
    if (!this.cancelling && (!this.turnActive || !this.turnStarted)) return;
    if (error.name === 'MessageAbortedError') {
      // The abort's own fallout (ours, or an external client's): fold it into the cancel path so
      // the idle settle reports `cancelled` — never surface it as an error.
      this.turnActive = false;
      this.cancelling = true;
      return;
    }
    this.turnFailed = true;
    const message = sessionErrorMessage(error);
    if (error.name === 'ProviderAuthError') {
      this.emitError(
        `opencode: provider authentication failed (${message})`,
        AUTH_FAILED_ERROR_CODE,
        false,
      );
      return;
    }
    this.emitError(message);
  }

  /** Answer a `permission.asked` through the shared permission round-trip: Allow→`once`,
   * Always allow→`always` (persisted server-side), Reject→`reject`. A teardown-cancelled ask also
   * replies `reject` — an unanswered ask would otherwise gate the turn server-side forever. */
  private async handlePermissionAsked(props: PermissionAsked): Promise<void> {
    const toolCallId =
      (props.tool && this.toolPartIdByCallId.get(props.tool.callID)) ??
      props.tool?.callID ??
      nextToolCallId();
    const outcome = await this.requestPermission(
      {
        toolCallId,
        title: props.permission,
        kind: toolKindFromName(props.permission),
        rawInput: props.metadata,
      },
      PERMISSION_OPTIONS,
    );
    if (!this.client) return;
    const allowed = outcome.outcome === 'selected';
    const reply =
      allowed && outcome.optionId === 'allow'
        ? 'once'
        : allowed && outcome.optionId === 'allow_always'
          ? 'always'
          : 'reject';
    try {
      okOrThrow(
        await this.client.permission.reply({
          requestID: props.id,
          directory: this.directory,
          reply,
        }),
        'opencode: permission.reply',
      );
    } catch (err) {
      // A teardown-cancelled reject races the abort that triggered it — the server may already
      // have discarded the ask, and that failure carries no signal.
      if (outcome.outcome !== 'cancelled') throw err;
    }
  }

  /** Surface `question.asked` as a structured question card (the analogue of claude-code's
   * AskUserQuestion): answers reply as one label array per question — `question.replied` echoes
   * exactly that shape — and a decline (or teardown cancel) rejects so the asking tool settles. */
  private async handleQuestionAsked(props: QuestionAsked): Promise<void> {
    const requestID = props.id;
    const directory = this.directory;
    if (props.questions.length === 0 || props.questions.some((q) => q.options.length === 0)) {
      // The Question schema requires ≥1 option per question; an ask we can't render must still be
      // answered or it gates the turn server-side forever.
      this.emitError('opencode: question ask carried no options; rejected');
      if (this.client) {
        okOrThrow(
          await this.client.question.reject({ requestID, directory }),
          'opencode: question.reject',
        );
      }
      return;
    }
    const toolCallId =
      (props.tool && this.toolPartIdByCallId.get(props.tool.callID)) ??
      props.tool?.callID ??
      nextToolCallId();
    const outcome = await this.requestQuestion(
      {
        toolCallId,
        title: 'question',
        kind: toolKindFromName('question'),
        rawInput: { questions: props.questions },
      },
      props.questions.map(
        (q, qi): Question => ({
          questionId: `q${qi}`,
          prompt: q.question,
          header: q.header,
          multiSelect: q.multiple ?? false,
          options: q.options.map((option, oi) => ({
            optionId: `o${oi}`,
            label: option.label,
            description: option.description,
          })),
        }),
      ),
    );
    if (!this.client) return;
    if (outcome.outcome === 'cancelled') {
      try {
        okOrThrow(
          await this.client.question.reject({ requestID, directory }),
          'opencode: question.reject',
        );
      } catch {
        // The cancel races the abort that triggered it — the ask may already be gone server-side.
      }
      return;
    }
    const byQuestionId = new Map(outcome.answers.map((answer) => [answer.questionId, answer]));
    const answers = props.questions.map((q, qi) => {
      const answer = byQuestionId.get(`q${qi}`);
      if (!answer) return [];
      const selected = new Set(answer.selectedOptionIds);
      const labels: string[] = [];
      for (const [oi, option] of q.options.entries()) {
        if (selected.has(`o${oi}`)) labels.push(option.label);
      }
      const custom = answer.customText?.trim();
      // Safe even for asks whose `custom` flag is unset: upstream Question.reply resolves the
      // answer arrays to the asking tool verbatim, with no validation against option labels
      // (anomalyco/opencode packages/opencode/src/question/index.ts).
      if (custom) labels.push(custom);
      return labels;
    });
    okOrThrow(
      await this.client.question.reply({ requestID, directory, answers }),
      'opencode: question.reply',
    );
  }

  private handlePart(part: Part): void {
    switch (part.type) {
      case 'text': {
        this.streamDelta(part.id, part.text, 'message');

        break;
      }
      case 'reasoning': {
        this.streamDelta(part.id, part.text, 'thought');

        break;
      }
      case 'tool': {
        this.toolPartIdByCallId.set(part.callID, part.id);
        // Same part→snapshot mapping history replay uses, so live and cold cards converge by id.
        this.emitTool(toolCallFromPart(part));

        break;
      }
      default:
        break;
    }
  }
}
