import type {
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
 * operation journal row persist together or not at all. */
export interface ConversationTurnIntent {
  readonly turn: ConversationTurn;
  readonly prompt?: PromptRecord;
  readonly operation: ConversationOperation;
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
  /** Upsert by `(turnId, historyId)` — one binding per provider history, re-captured on re-read. */
  saveBinding(binding: ProviderTurnBinding): Promise<void>;
  getOperation(operationId: OperationId): Promise<ConversationOperation | undefined>;
  /** Open operations, for the per-session admit gate and boot recovery (no argument = all). */
  listOpenOperations(sessionId?: SessionId): Promise<ConversationOperation[]>;
  /** Atomic: persist the turn, its prompt (if any), and the open operation in one transaction. */
  persistTurnIntent(intent: ConversationTurnIntent): Promise<void>;
  /** Atomic: store the operation's terminal result and, when given, the turn's new state. */
  resolveOperation(operation: ConversationOperation, turn?: ConversationTurn): Promise<void>;
  /** Purge the session's turns, bindings, and operations. Prompts are shared by reference across
   * forks: one is deleted only when no turn in ANY session still references it. */
  deleteSession(sessionId: SessionId): Promise<void>;
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly turns = new Map<TurnId, ConversationTurn>();
  private readonly prompts = new Map<PromptId, PromptRecord>();
  private readonly bindings = new Map<string, ProviderTurnBinding>();
  private readonly operations = new Map<OperationId, ConversationOperation>();

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
    this.bindings.set(`${binding.turnId}\0${binding.historyId}`, structuredClone(binding));
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

  async persistTurnIntent(intent: ConversationTurnIntent): Promise<void> {
    await this.saveTurn(intent.turn);
    if (intent.prompt) this.prompts.set(intent.prompt.promptId, structuredClone(intent.prompt));
    this.operations.set(intent.operation.operationId, structuredClone(intent.operation));
  }

  async resolveOperation(operation: ConversationOperation, turn?: ConversationTurn): Promise<void> {
    this.operations.set(operation.operationId, structuredClone(operation));
    if (turn) await this.saveTurn(turn);
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
      if (turn.input.type === 'prompt') referenced.add(turn.input.promptId);
    }
    for (const promptId of this.prompts.keys()) {
      if (!referenced.has(promptId)) this.prompts.delete(promptId);
    }
    return Promise.resolve();
  }
}
