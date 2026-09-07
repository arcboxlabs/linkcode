import { randomUUID } from 'node:crypto';
import type { HistoryCheckpoint } from '@linkcode/agent-adapter';
import type {
  AttachmentId,
  ContentBlock,
  ConversationOperation,
  ConversationTurn,
  ConversationTurnState,
  OperationId,
  PromptBlock,
  PromptId,
  PromptRecord,
  ProviderTurnBinding,
  RunId,
  SessionId,
  StopReason,
  TurnId,
  TurnInput,
} from '@linkcode/schema';
import { attachmentUri } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import type { AttachmentStore } from '../attachment/attachment-store';
import { InMemoryAttachmentStore } from '../attachment/attachment-store';
import { OperationError, RequestError } from '../failure';
import type { SessionRecordRegistry } from '../session/session-record-registry';
import type { ConversationStore } from './conversation-store';
import { ConversationSessionBusyError } from './conversation-store';

export function mintOperationId(): OperationId {
  return `op-${randomUUID()}` as OperationId;
}

function mintTurnId(): TurnId {
  return `turn-${randomUUID()}` as TurnId;
}

function mintPromptId(): PromptId {
  return `prompt-${randomUUID()}` as PromptId;
}

/** What a submit wants persisted, before ids and ordinals exist. */
export interface TurnIntentSpec {
  readonly sessionId: SessionId;
  readonly operationId: OperationId;
  readonly runId: RunId;
  readonly parentTurnId: TurnId | null;
  readonly input:
    | { readonly type: 'prompt'; readonly blocks: PromptBlock[] }
    | { readonly type: 'command'; readonly name: string; readonly arguments?: string }
    | { readonly type: 'shell-command'; readonly command: string };
}

export interface PersistedTurnIntent {
  readonly turn: ConversationTurn;
  readonly operation: Extract<ConversationOperation, { state: 'open' }>;
}

/** A dispatch failure as the saga reports it. The stored row keeps `code`/`message` only; the flag
 * says the rejection was also broadcast into the conversation live, which only the immediate reply
 * can lean on — a replay after a disconnect has no live event behind it. */
export interface TurnFailure {
  readonly code: string;
  readonly message: string;
  readonly reportedInConversation?: true;
}

export type TerminalOperation =
  | Extract<ConversationOperation, { state: 'succeeded' }>
  | (Omit<Extract<ConversationOperation, { state: 'failed' }>, 'error'> & {
      readonly error: TurnFailure;
    });

export const TERMINAL_TURN_STATES = new Set<ConversationTurnState>([
  'completed',
  'failed',
  'cancelled',
]);

interface RunningTurn {
  readonly turn: ConversationTurn;
  sawError: boolean;
  /** False while only tracked off the adapter's `running`, before the dispatch commits it. */
  committed: boolean;
  /** A settle that landed before the commit; the commit writes it behind its own row, a failed
   * dispatch discards it with the turn. */
  settledAs?: ConversationTurnState;
}

/**
 * The durable side of turn execution: persists submit intents into the {@link ConversationStore},
 * commits/fails their operations, and tracks the running turn per session so adapter lifecycle
 * events settle it. Every turn-starting input — new `turn.submit` or legacy `agent.input` — flows
 * through here, so the graph never misses a turn.
 */
export class ConversationTurnService {
  /** The running turn per session; settles are addressed by the turn's own runId. */
  private readonly running = new Map<SessionId, RunningTurn>();
  /** The persisted intent between its persist and its commit/failure; the adapter's `running`
   * status promotes it to the running turn ({@link noteRunning}). */
  private readonly dispatching = new Map<SessionId, PersistedTurnIntent>();
  /** When a turn last flipped terminal — the projection's cache-freshness bound: a provider
   * corpus captured before the newest settle may be missing that turn's rows. */
  private readonly settledAt = new Map<SessionId, number>();

  constructor(
    private readonly store: ConversationStore,
    private readonly records: SessionRecordRegistry,
    private readonly transport: Transport,
    private readonly runTask: (effect: Effect.Effect<void>) => void,
    private readonly attachments: AttachmentStore = new InMemoryAttachmentStore(),
  ) {}

  getOperation(
    operationId: OperationId,
  ): Effect.Effect<ConversationOperation | undefined, OperationError> {
    return storeOperation('conversation.operation.get', () => this.store.getOperation(operationId));
  }

  hasOpenOperation(sessionId: SessionId): Effect.Effect<boolean, OperationError> {
    return storeOperation('conversation.operations.list', () =>
      this.store.listOpenOperations(sessionId),
    ).pipe(Effect.map((operations) => operations.length > 0));
  }

  listTurns(sessionId: SessionId): Effect.Effect<ConversationTurn[], OperationError> {
    return storeOperation('conversation.turns.list', () => this.store.listTurns(sessionId));
  }

  getPrompt(promptId: PromptId): Effect.Effect<PromptRecord | undefined, OperationError> {
    return storeOperation('conversation.prompt.get', () => this.store.getPrompt(promptId));
  }

  lastSettledAt(sessionId: SessionId): number | undefined {
    return this.settledAt.get(sessionId);
  }

  listBindings(turnId: TurnId): Effect.Effect<ProviderTurnBinding[], OperationError> {
    return storeOperation('conversation.bindings.list', () => this.store.listBindings(turnId));
  }

  /** A binding derived from a cold read (`capturedFrom: 'replay'`); the store keeps an existing
   * live capture over it. */
  saveReplayBinding(binding: ProviderTurnBinding): Effect.Effect<void, OperationError> {
    return storeOperation('conversation.binding.save', () => this.store.saveBinding(binding));
  }

  /** The turn's user-row content from host truth; undefined for migrated null-prompt turns. */
  hostUserContent(
    turn: ConversationTurn,
  ): Effect.Effect<ContentBlock[] | undefined, OperationError> {
    const input = turn.input;
    if (input.type === 'command' || input.type === 'shell-command') {
      return Effect.succeed([{ type: 'text' as const, text: turnInputText(input) }]);
    }
    if (input.promptId === null) return Effect.undefined;
    const { attachments } = this;
    return this.getPrompt(input.promptId).pipe(
      Effect.flatMap((prompt) => {
        if (!prompt) return Effect.undefined;
        const ids: AttachmentId[] = [];
        for (let i = 0, len = prompt.blocks.length; i < len; i++) {
          const block = prompt.blocks[i];
          if (block.type === 'attachment_ref') ids.push(block.attachmentId);
        }
        const load =
          ids.length === 0
            ? Effect.succeed([])
            : storeOperation('attachments.list', () => attachments.listAttachments(ids));
        return load.pipe(
          Effect.map((stored) => {
            const byId = new Map(stored.map((attachment) => [attachment.attachmentId, attachment]));
            const content: ContentBlock[] = [];
            for (let i = 0, len = prompt.blocks.length; i < len; i++) {
              const block = prompt.blocks[i];
              if (block.type === 'text') {
                content.push({ type: 'text', text: block.text });
                continue;
              }
              const attachment = byId.get(block.attachmentId);
              content.push({
                type: 'resource_link',
                uri: attachmentUri(block.attachmentId),
                name: attachment?.name ?? block.attachmentId,
                // `kind` rides `description`, never `title`: renderers prefer `title` over `name`,
                // so putting it there labels every attachment chip "image" instead of its filename.
                ...(attachment !== undefined && {
                  mimeType: attachment.mimeType,
                  size: attachment.sizeBytes,
                  description: attachment.kind,
                }),
              });
            }
            return content;
          }),
        );
      }),
    );
  }

  deleteSession(sessionId: SessionId): Effect.Effect<void, OperationError> {
    return storeOperation('conversation.delete-session', () =>
      this.store.deleteSession(sessionId),
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          this.running.delete(sessionId);
          this.dispatching.delete(sessionId);
          this.settledAt.delete(sessionId);
        }),
      ),
    );
  }

  /** The durable commit point: turn (`preparing`, ordinal store-assigned inside the transaction),
   * prompt, and open operation persist in one transaction, before any irreversible provider work.
   * The store's own admission guard turns a racing intent into a typed `busy`. */
  persistIntent(
    spec: TurnIntentSpec,
  ): Effect.Effect<PersistedTurnIntent, OperationError | RequestError> {
    return Effect.gen({ self: this }, function* () {
      const now = Date.now();
      let prompt: PromptRecord | undefined;
      let input: TurnInput;
      if (spec.input.type === 'prompt') {
        prompt = {
          promptId: mintPromptId(),
          blocks: spec.input.blocks,
          contextAttachmentIds: [],
          createdAt: now,
        };
        input = { type: 'prompt', promptId: prompt.promptId };
      } else {
        input = spec.input;
      }
      const turn: Omit<ConversationTurn, 'siblingOrdinal'> = {
        turnId: mintTurnId(),
        sessionId: spec.sessionId,
        parentTurnId: spec.parentTurnId,
        input,
        runId: spec.runId,
        state: 'preparing',
        createdAt: now,
      };
      const operation = {
        operationId: spec.operationId,
        sessionId: spec.sessionId,
        kind: 'turn.submit' as const,
        state: 'open' as const,
        createdAt: now,
      };
      const persisted = yield* storeOperation('conversation.intent.persist', () =>
        this.store.persistTurnIntent({ turn, prompt, operation }),
      ).pipe(
        Effect.catch((error) =>
          Effect.fail(
            error.cause instanceof ConversationSessionBusyError
              ? new RequestError({
                  code: 'busy',
                  message: 'Another operation is open on this session',
                })
              : error,
          ),
        ),
      );
      const intent = { turn: persisted, operation };
      this.dispatching.set(spec.sessionId, intent);
      return intent;
    });
  }

  /** The adapter announced `running` for `runId`'s dispatching turn: track it in memory only. A
   * whole-turn send() (pi, grok) settles before it resolves — tracked late, its own stop would
   * settle its predecessor. The durable commit stays with the dispatch resolution: an adapter that
   * emits `running` and then rejects the send must resolve `failed`, never a phantom turn. */
  noteRunning(sessionId: SessionId, runId: RunId): void {
    const intent = this.dispatching.get(sessionId);
    if (intent?.turn.runId !== runId) return;
    this.track(intent.turn, false);
  }

  /** The provider accepted the dispatch: one transaction stores the success and flips the turn to
   * `running`, and ONLY the call that transitioned the row runs the side effects — a concurrent
   * commit (dispatch-timer rescue vs the send continuation) must move the graph exactly once.
   * Uninterruptible: an interrupt between the store write and the graph move would strand a
   * succeeded operation behind a stale active leaf; the whole chain is a few sync-SQLite hops. */
  commitRunning(intent: PersistedTurnIntent): Effect.Effect<void, OperationError> {
    const turn: ConversationTurn = { ...intent.turn, state: 'running' };
    const operation: ConversationOperation = {
      ...intent.operation,
      state: 'succeeded',
      turnId: turn.turnId,
      resolvedAt: Date.now(),
    };
    return storeOperation('conversation.operation.resolve', () =>
      this.store.resolveOperation(operation, turn),
    ).pipe(
      Effect.flatMap((transitioned) =>
        transitioned
          ? Effect.sync(() => {
              this.trackCommitted(turn);
              const graphRevision = this.records.commitGraphMove(turn.sessionId, turn.turnId);
              if (graphRevision !== undefined) {
                this.transport.send(
                  createWireMessage({
                    kind: 'conversation.graph.changed',
                    sessionId: turn.sessionId,
                    graphRevision,
                    activeLeafTurnId: turn.turnId,
                  }),
                );
              }
            })
          : Effect.void,
      ),
      Effect.uninterruptible,
    );
  }

  /** Store the typed failure — unless a concurrent resolver already stored a terminal result, in
   * which case the STORED result is returned: the reply must never differ from what a retry of the
   * operationId will replay. */
  resolveFailed(
    intent: PersistedTurnIntent,
    error: TurnFailure,
  ): Effect.Effect<TerminalOperation, OperationError> {
    return Effect.gen({ self: this }, function* () {
      const operation = {
        ...intent.operation,
        state: 'failed' as const,
        error: { code: error.code, message: error.message },
        resolvedAt: Date.now(),
      };
      const transitioned = yield* storeOperation('conversation.operation.resolve', () =>
        this.store.resolveOperation(operation, { ...intent.turn, state: 'failed' }),
      );
      if (!transitioned) {
        const stored = yield* this.getOperation(intent.operation.operationId);
        if (stored === undefined || stored.state === 'open') {
          return yield* Effect.fail(
            new OperationError({
              subsystem: 'store',
              operation: 'conversation.operation.resolve',
              publicMessage: 'The operation resolution was lost',
              cause: undefined,
            }),
          );
        }
        return stored;
      }
      const { sessionId, turnId } = intent.turn;
      if (this.running.get(sessionId)?.turn.turnId === turnId) this.running.delete(sessionId);
      if (this.dispatching.get(sessionId)?.turn.turnId === turnId) {
        this.dispatching.delete(sessionId);
      }
      // A failed turn keeps its ordinal and renders with a state badge, so every device must learn
      // the tree gained it — the default leaf did not move.
      this.announceGraph(sessionId, true);
      return { ...operation, error };
    });
  }

  /** Every device refetches the tree. A node they did not have bumps the revision — the shape
   * moved; a visible turn reaching its terminal state keeps it — only its badge changed, and a
   * settle must not turn a peer's in-flight explicit-parent submit into a `conflict`. */
  private announceGraph(sessionId: SessionId, gainedNode: boolean): void {
    if (gainedNode) this.records.commitGraphShape(sessionId);
    const record = this.records.get(sessionId);
    if (record === undefined) return;
    this.transport.send(
      createWireMessage({
        kind: 'conversation.graph.changed',
        sessionId,
        graphRevision: record.graphRevision,
        ...(record.activeLeafTurnId !== undefined && { activeLeafTurnId: record.activeLeafTurnId }),
      }),
    );
  }

  /** {@link resolveFailed} for exit paths inside a session-scoped fiber: enqueued on the engine
   * task runner so an interrupting teardown never waits behind the store write. */
  resolveFailedDetached(intent: PersistedTurnIntent, error: TurnFailure): void {
    this.runTask(
      this.resolveFailed(intent, error).pipe(
        Effect.catch((resolveError) =>
          Effect.logError(
            'Failed to record the rejected turn',
            { sessionId: intent.turn.sessionId },
            resolveError.cause,
          ),
        ),
        Effect.asVoid,
      ),
    );
  }

  /** Boot recovery: no adapter survives a restart, so every open operation and every non-terminal
   * turn is dead. Resolve them as failed — a retry then replays a typed error instead of hanging,
   * and the graph shows the attempt as `failed`, never absent. */
  recover(sessionIds: Iterable<SessionId>): Effect.Effect<void, OperationError> {
    return Effect.gen({ self: this }, function* () {
      const open = yield* storeOperation('conversation.operations.list', () =>
        this.store.listOpenOperations(),
      );
      // Open operations can outlive their session record; sweep their sessions too.
      const sweep = new Set<SessionId>(sessionIds);
      for (let i = 0, len = open.length; i < len; i++) sweep.add(open[i].sessionId);
      for (const sessionId of sweep) {
        const turns = yield* this.listTurns(sessionId);
        const activeLeafTurnId = this.records.get(sessionId)?.activeLeafTurnId;
        const threadRunId = turns.find((turn) => turn.turnId === activeLeafTurnId)?.runId;
        for (let i = 0, len = turns.length; i < len; i++) {
          const turn = turns[i];
          if (TERMINAL_TURN_STATES.has(turn.state)) continue;
          yield* storeOperation('conversation.turn.save', () =>
            this.store.saveTurn({ ...turn, state: 'failed' }),
          );
          // A dead turn off the thread's run was a relaunch that never became the thread.
          if (turn.runId !== threadRunId) this.records.abandonRun(sessionId, turn.runId);
        }
      }
      const resolvedAt = Date.now();
      for (let i = 0, len = open.length; i < len; i++) {
        const operation = open[i];
        yield* storeOperation('conversation.operation.resolve', () =>
          this.store.resolveOperation({
            ...operation,
            state: 'failed',
            error: {
              code: 'operation_failed',
              message: 'The daemon restarted before the turn was dispatched',
            },
            resolvedAt,
          }),
        );
      }
    });
  }

  /** The running turn `runId` owns, for event attribution; undefined between dispatch and commit. */
  runningTurnId(sessionId: SessionId, runId: RunId): TurnId | undefined {
    return this.runningFor(sessionId, runId)?.turn.turnId;
  }

  /** Persist a live fork checkpoint as the binding of the turn it describes: `ending` → the turn
   * `runId` is executing, `preceding` → that turn's parent (a root has none), filed under the
   * parent's own run — a binding names the run that executed its turn, and a successor may run in
   * another. A checkpoint from a run that is neither dispatching nor running a turn (a replaced
   * adapter) binds nothing. */
  bindLiveCheckpoint(sessionId: SessionId, runId: RunId, checkpoint: HistoryCheckpoint): void {
    const dispatching = this.dispatching.get(sessionId)?.turn;
    const turn =
      dispatching?.runId === runId ? dispatching : this.runningFor(sessionId, runId)?.turn;
    if (!turn) return;
    const cut = {
      historyId: checkpoint.historyId,
      checkpoint: checkpoint.cursor,
      capturedFrom: 'live' as const,
    };
    if (checkpoint.turn === 'ending') {
      this.saveBinding(turn.turnId, Effect.succeed({ ...cut, turnId: turn.turnId, runId }));
      return;
    }
    const { parentTurnId } = turn;
    if (parentTurnId === null) return;
    this.saveBinding(
      parentTurnId,
      this.listTurns(sessionId).pipe(
        Effect.map((turns) => {
          const parent = turns.find((candidate) => candidate.turnId === parentTurnId);
          return parent === undefined
            ? undefined
            : { ...cut, turnId: parentTurnId, runId: parent.runId };
        }),
      ),
    );
  }

  /** An adapter `error` while the run's turn is live; decides `failed` on a stop-less settle. */
  noteError(sessionId: SessionId, runId: RunId): void {
    const entry = this.runningFor(sessionId, runId);
    if (entry) entry.sawError = true;
  }

  /** `stop` is the turn's own settle signal; `cancelled` is the only non-complete reason. */
  settleStop(sessionId: SessionId, runId: RunId, stopReason: StopReason): void {
    this.settle(sessionId, runId, stopReason === 'cancelled' ? 'cancelled' : 'completed');
  }

  /** Fallback settle for turns that end without a `stop` frame: a failed turn's idle settle, or an
   * adapter stopped/torn down mid-turn. */
  settleStatus(sessionId: SessionId, runId: RunId, status: 'idle' | 'stopped'): void {
    const entry = this.runningFor(sessionId, runId);
    if (!entry) return;
    this.settle(
      sessionId,
      runId,
      entry.sawError ? 'failed' : status === 'idle' ? 'completed' : 'cancelled',
    );
  }

  /** The first settle stands. Before the durable commit landed it is only recorded here: the
   * commit's own `running` row must not land over the terminal state. */
  private settle(sessionId: SessionId, runId: RunId, state: ConversationTurnState): void {
    const entry = this.runningFor(sessionId, runId);
    if (!entry || entry.settledAs !== undefined) return;
    if (!entry.committed) {
      entry.settledAs = state;
      this.settledAt.set(sessionId, Date.now());
      return;
    }
    this.running.delete(sessionId);
    this.persistTurnState(entry.turn, state);
  }

  /** The session's running turn, only when it belongs to `runId` — a replaced run's stragglers
   * must not settle its successor's turn. */
  private runningFor(sessionId: SessionId, runId: RunId): RunningTurn | undefined {
    const entry = this.running.get(sessionId);
    if (entry === undefined) return undefined;
    return entry.turn.runId === runId ? entry : undefined;
  }

  /** The commit landed. A turn already tracked off the adapter's `running` keeps its entry (and
   * error flag); one that settled meanwhile gets its terminal state written now, behind the row. */
  private trackCommitted(turn: ConversationTurn): void {
    const entry = this.running.get(turn.sessionId);
    if (entry?.turn.turnId !== turn.turnId) {
      this.track(turn, true);
      return;
    }
    if (entry.settledAs === undefined) {
      entry.committed = true;
      return;
    }
    this.running.delete(turn.sessionId);
    this.persistTurnState(turn, entry.settledAs);
  }

  private track(turn: ConversationTurn, committed: boolean): void {
    const stale = this.running.get(turn.sessionId);
    // A new dispatch was admitted, so an unsettled predecessor demonstrably ended; close it out —
    // as failed when an adapter error was seen during its run, never a guessed 'completed'.
    if (stale && stale.turn.turnId !== turn.turnId) {
      this.persistTurnState(
        stale.turn,
        stale.settledAs ?? (stale.sawError ? 'failed' : 'completed'),
      );
    }
    this.running.set(turn.sessionId, { turn, sawError: false, committed });
    if (this.dispatching.get(turn.sessionId)?.turn.turnId === turn.turnId) {
      this.dispatching.delete(turn.sessionId);
    }
  }

  /** Bindings are written off synchronous adapter callbacks, best-effort like turn settles. */
  private saveBinding(
    turnId: TurnId,
    binding: Effect.Effect<ProviderTurnBinding | undefined, OperationError>,
  ): void {
    this.runTask(
      binding.pipe(
        Effect.flatMap((resolved) =>
          resolved === undefined
            ? Effect.void
            : storeOperation('conversation.binding.save', () => this.store.saveBinding(resolved)),
        ),
        Effect.catch((error) =>
          Effect.logError(error.publicMessage, { operation: error.operation, turnId }, error.cause),
        ),
      ),
    );
  }

  /** Settles run off synchronous adapter callbacks, so persistence is enqueued best-effort. */
  private persistTurnState(turn: ConversationTurn, state: ConversationTurnState): void {
    if (TERMINAL_TURN_STATES.has(turn.state)) return;
    this.settledAt.set(turn.sessionId, Date.now());
    this.runTask(
      storeOperation('conversation.turn.save', () => this.store.saveTurn({ ...turn, state })).pipe(
        Effect.tap(() => Effect.sync(() => this.announceGraph(turn.sessionId, false))),
        Effect.catch((error) =>
          Effect.logError(
            error.publicMessage,
            { operation: error.operation, sessionId: turn.sessionId },
            error.cause,
          ),
        ),
      ),
    );
  }
}

/** How a command or shell turn reads as a user row. */
export function turnInputText(
  input: Extract<ConversationTurn['input'], { type: 'command' | 'shell-command' }>,
): string {
  return input.type === 'command'
    ? `/${input.name}${input.arguments === undefined ? '' : ` ${input.arguments}`}`
    : `$ ${input.command}`;
}

function storeOperation<A>(
  operation: string,
  run: () => Promise<A>,
): Effect.Effect<A, OperationError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new OperationError({
        subsystem: 'store',
        operation,
        publicMessage: 'Conversation store operation failed',
        cause,
      }),
  });
}
