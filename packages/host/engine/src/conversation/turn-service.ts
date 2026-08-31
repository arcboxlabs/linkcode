import { randomUUID } from 'node:crypto';
import type {
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
import type { Transport } from '@linkcode/transport';
import { createWireMessage } from '@linkcode/transport';
import { Effect } from 'effect';
import { OperationError } from '../failure';
import type { SessionRecordRegistry } from '../session/session-record-registry';
import type { ConversationStore } from './conversation-store';

export function mintOperationId(): OperationId {
  return `op-${randomUUID()}` as OperationId;
}

function mintTurnId(): TurnId {
  return `turn-${randomUUID()}` as TurnId;
}

function mintPromptId(): PromptId {
  return `prompt-${randomUUID()}` as PromptId;
}

/** Durable prompt blocks from legacy prompt content: text only for now — binary attachments
 * become `attachment_ref`s once the attachment store lands. */
export function promptBlocksFromContent(content: ContentBlock[]): PromptBlock[] {
  return content.flatMap((block) =>
    block.type === 'text' ? [{ type: 'text' as const, text: block.text }] : [],
  );
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

export type TerminalOperation = Extract<ConversationOperation, { state: 'succeeded' | 'failed' }>;

const TERMINAL_TURN_STATES = new Set<ConversationTurnState>(['completed', 'failed', 'cancelled']);

interface RunningTurn {
  readonly turn: ConversationTurn;
  sawError: boolean;
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

  constructor(
    private readonly store: ConversationStore,
    private readonly records: SessionRecordRegistry,
    private readonly transport: Transport,
    private readonly runTask: (effect: Effect.Effect<void>) => void,
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

  listBindings(turnId: TurnId): Effect.Effect<ProviderTurnBinding[], OperationError> {
    return storeOperation('conversation.bindings.list', () => this.store.listBindings(turnId));
  }

  /** The durable commit point: turn (`preparing`), prompt, and open operation persist in one
   * transaction, before any irreversible provider work. Preparing turns are not broadcast. */
  persistIntent(spec: TurnIntentSpec): Effect.Effect<PersistedTurnIntent, OperationError> {
    return Effect.gen({ self: this }, function* () {
      const siblings = yield* this.listTurns(spec.sessionId);
      // Rows are never deleted and failed/cancelled turns keep their ordinals, so a count is stable.
      const siblingOrdinal =
        siblings.filter((turn) => turn.parentTurnId === spec.parentTurnId).length + 1;
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
      const turn: ConversationTurn = {
        turnId: mintTurnId(),
        sessionId: spec.sessionId,
        parentTurnId: spec.parentTurnId,
        siblingOrdinal,
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
      yield* storeOperation('conversation.intent.persist', () =>
        this.store.persistTurnIntent({ turn, prompt, operation }),
      );
      return { turn, operation };
    });
  }

  /** The provider accepted the dispatch: one transaction stores the success and flips the turn to
   * `running`; then the host default leaf moves and the graph change is announced. */
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
      Effect.andThen(
        Effect.sync(() => {
          this.trackRunning(turn);
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
        }),
      ),
    );
  }

  /** Store the typed failure — unless a concurrent path already resolved the operation, whose
   * terminal result then stands. Retrying the operationId replays the stored result verbatim. */
  resolveFailed(
    intent: PersistedTurnIntent,
    error: { readonly code: string; readonly message: string },
  ): Effect.Effect<TerminalOperation, OperationError> {
    return Effect.gen({ self: this }, function* () {
      const current = yield* this.getOperation(intent.operation.operationId);
      if (current && current.state !== 'open') return current;
      const operation = {
        ...intent.operation,
        state: 'failed' as const,
        error: { code: error.code, message: error.message },
        resolvedAt: Date.now(),
      };
      yield* storeOperation('conversation.operation.resolve', () =>
        this.store.resolveOperation(operation, { ...intent.turn, state: 'failed' }),
      );
      const running = this.running.get(intent.turn.sessionId);
      if (running?.turn.turnId === intent.turn.turnId) this.running.delete(intent.turn.sessionId);
      return operation;
    });
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

  private settle(sessionId: SessionId, runId: RunId, state: ConversationTurnState): void {
    const entry = this.runningFor(sessionId, runId);
    if (!entry) return;
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

  private trackRunning(turn: ConversationTurn): void {
    const stale = this.running.get(turn.sessionId);
    // A new dispatch was admitted, so an unsettled predecessor demonstrably ended; close it out.
    if (stale && stale.turn.turnId !== turn.turnId) this.persistTurnState(stale.turn, 'completed');
    this.running.set(turn.sessionId, { turn, sawError: false });
  }

  /** Settles run off synchronous adapter callbacks, so persistence is enqueued best-effort. */
  private persistTurnState(turn: ConversationTurn, state: ConversationTurnState): void {
    if (TERMINAL_TURN_STATES.has(turn.state)) return;
    this.runTask(
      storeOperation('conversation.turn.save', () => this.store.saveTurn({ ...turn, state })).pipe(
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
