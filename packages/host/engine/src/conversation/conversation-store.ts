import type {
  AttachmentId,
  ConversationOperation,
  ConversationTurn,
  OperationId,
  PromptId,
  PromptRecord,
  ProviderTurnBinding,
  SessionId,
  TurnId,
} from '@linkcode/schema';

/** The durable commit point of a submit: the turn, its prompt (for prompt inputs), and the open
 * operation journal row persist together or not at all. `siblingOrdinal` is store-assigned inside
 * the persist transaction, so racing submits cannot compute the same ordinal. */
export interface ConversationTurnIntent {
  readonly turn: Omit<ConversationTurn, 'siblingOrdinal'>;
  readonly prompt?: PromptRecord;
  readonly operation: ConversationOperation;
}

/** Rejection from {@link ConversationStore.persistTurnIntent} when the session already has an
 * open operation — the durable backstop behind the engine's admit gate. */
export class ConversationSessionBusyError extends Error {
  constructor(sessionId: SessionId, options?: ErrorOptions) {
    super(`Another operation is open on session ${sessionId}`, options);
    this.name = 'ConversationSessionBusyError';
  }
}

/**
 * Durable turn-tree storage: turns, immutable prompts, provider bindings, and the operation
 * journal. The daemon injects a single-connection SQLite implementation — the multi-row methods
 * MUST be atomic there, because the submit saga's guarantees hang on them; the in-memory default
 * is for tests and embedders.
 */
export interface ConversationStore {
  listTurns(sessionId: SessionId): Promise<ConversationTurn[]>;
  /** Upsert by `turnId` — state flips rewrite the row. */
  saveTurn(turn: ConversationTurn): Promise<void>;
  getPrompt(promptId: PromptId): Promise<PromptRecord | undefined>;
  listBindings(turnId: TurnId): Promise<ProviderTurnBinding[]>;
  /** One binding per `(turnId, historyId)`: a `replay` row is re-captured on re-read, a `live` row
   * is never overwritten — the first live capture is the cut, whatever arrives later. */
  saveBinding(binding: ProviderTurnBinding): Promise<void>;
  getOperation(operationId: OperationId): Promise<ConversationOperation | undefined>;
  /** Open operations, for the per-session admit gate and boot recovery (no argument = all). */
  listOpenOperations(sessionId?: SessionId): Promise<ConversationOperation[]>;
  /** Atomic: assign `siblingOrdinal`, then insert the turn, its prompt (if any), and the open
   * operation in one transaction; the assigned turn is returned. Rejects with
   * {@link ConversationSessionBusyError} while the session has an open operation; rows are
   * plain-inserted, so a replayed operationId conflicts instead of re-opening a terminal row. */
  persistTurnIntent(intent: ConversationTurnIntent): Promise<ConversationTurn>;
  /** Atomic: store the operation's terminal result and, when given, the turn's new state — but
   * only while the operation row is still `open`. Returns whether THIS call performed the
   * transition; the first terminal writer stands and losers must run no side effects. */
  resolveOperation(operation: ConversationOperation, turn?: ConversationTurn): Promise<boolean>;
  /** Purge the session's turns, bindings, and operations. Prompts are shared by reference across
   * forks: one is deleted only when no turn in ANY session still references it. */
  deleteSession(sessionId: SessionId): Promise<void>;
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly turns = new Map<TurnId, ConversationTurn>();
  private readonly prompts = new Map<PromptId, PromptRecord>();
  private readonly bindings = new Map<string, ProviderTurnBinding>();
  private readonly operations = new Map<OperationId, ConversationOperation>();

  /** GC roots for the in-memory attachment store: every attachment a persisted prompt references. */
  referencedAttachmentIds(): AttachmentId[] {
    const ids: AttachmentId[] = [];
    for (const prompt of this.prompts.values()) {
      for (let i = 0, len = prompt.contextAttachmentIds.length; i < len; i++) {
        ids.push(prompt.contextAttachmentIds[i]);
      }
      for (let i = 0, len = prompt.blocks.length; i < len; i++) {
        const block = prompt.blocks[i];
        if (block.type === 'attachment_ref') ids.push(block.attachmentId);
      }
    }
    return ids;
  }

  listTurns(sessionId: SessionId): Promise<ConversationTurn[]> {
    const turns = [];
    for (const turn of this.turns.values()) {
      if (turn.sessionId === sessionId) turns.push(structuredClone(turn));
    }
    return Promise.resolve(turns);
  }

  saveTurn(turn: ConversationTurn): Promise<void> {
    this.turns.set(turn.turnId, structuredClone(turn));
    return Promise.resolve();
  }

  getPrompt(promptId: PromptId): Promise<PromptRecord | undefined> {
    const prompt = this.prompts.get(promptId);
    return Promise.resolve(prompt && structuredClone(prompt));
  }

  listBindings(turnId: TurnId): Promise<ProviderTurnBinding[]> {
    const bindings = [];
    for (const binding of this.bindings.values()) {
      if (binding.turnId === turnId) bindings.push(structuredClone(binding));
    }
    return Promise.resolve(bindings);
  }

  saveBinding(binding: ProviderTurnBinding): Promise<void> {
    const key = `${binding.turnId}\0${binding.historyId}`;
    if (this.bindings.get(key)?.capturedFrom !== 'live') {
      this.bindings.set(key, structuredClone(binding));
    }
    return Promise.resolve();
  }

  getOperation(operationId: OperationId): Promise<ConversationOperation | undefined> {
    const operation = this.operations.get(operationId);
    return Promise.resolve(operation && structuredClone(operation));
  }

  listOpenOperations(sessionId?: SessionId): Promise<ConversationOperation[]> {
    const open = [];
    for (const operation of this.operations.values()) {
      if (operation.state === 'open' && (!sessionId || operation.sessionId === sessionId)) {
        open.push(structuredClone(operation));
      }
    }
    return Promise.resolve(open);
  }

  persistTurnIntent(intent: ConversationTurnIntent): Promise<ConversationTurn> {
    const { sessionId, parentTurnId } = intent.turn;
    for (const operation of this.operations.values()) {
      if (operation.sessionId === sessionId && operation.state === 'open') {
        return Promise.reject(new ConversationSessionBusyError(sessionId));
      }
    }
    if (this.operations.has(intent.operation.operationId)) {
      return Promise.reject(
        new Error(`Operation already persisted: ${intent.operation.operationId}`),
      );
    }
    let siblingOrdinal = 1;
    for (const existing of this.turns.values()) {
      if (existing.sessionId === sessionId && existing.parentTurnId === parentTurnId) {
        siblingOrdinal += 1;
      }
    }
    const turn: ConversationTurn = { ...intent.turn, siblingOrdinal };
    // All mutations happen synchronously, so a racing persist cannot pass the guard mid-write —
    // the same atomicity the SQLite transaction gives the daemon store.
    this.turns.set(turn.turnId, structuredClone(turn));
    if (
      intent.turn.input.type === 'prompt' &&
      intent.turn.input.promptId !== null &&
      intent.prompt
    ) {
      this.prompts.set(intent.prompt.promptId, structuredClone(intent.prompt));
    }
    this.operations.set(intent.operation.operationId, structuredClone(intent.operation));
    return Promise.resolve(turn);
  }

  resolveOperation(operation: ConversationOperation, turn?: ConversationTurn): Promise<boolean> {
    if (this.operations.get(operation.operationId)?.state !== 'open') {
      return Promise.resolve(false);
    }
    this.operations.set(operation.operationId, structuredClone(operation));
    if (turn) this.turns.set(turn.turnId, structuredClone(turn));
    return Promise.resolve(true);
  }

  deleteSession(sessionId: SessionId): Promise<void> {
    for (const [turnId, turn] of this.turns) {
      if (turn.sessionId !== sessionId) continue;
      this.turns.delete(turnId);
      for (const [key, binding] of this.bindings) {
        if (binding.turnId === turnId) this.bindings.delete(key);
      }
    }
    for (const [operationId, operation] of this.operations) {
      if (operation.sessionId === sessionId) this.operations.delete(operationId);
    }
    const referenced = new Set<PromptId>();
    for (const turn of this.turns.values()) {
      if (turn.input.type === 'prompt' && turn.input.promptId !== null) {
        referenced.add(turn.input.promptId);
      }
    }
    for (const promptId of this.prompts.keys()) {
      if (!referenced.has(promptId)) this.prompts.delete(promptId);
    }
    return Promise.resolve();
  }
}
