import { asHistoryId } from '@linkcode/agent-adapter';
import type {
  AgentHistoryBranchOptions,
  AgentHistoryEvent,
  AgentHistoryId,
  ContentBlock,
  ConversationTurn,
  ProviderTurnBinding,
  SessionRecord,
  TurnId,
} from '@linkcode/schema';
import { Effect } from 'effect';
import { OperationError } from '../failure';
import type { HistoryBranchCut, HistoryService } from '../session/history-service';
import { promptContentFingerprint } from '../session/live-session';
import type { SessionRecordRegistry } from '../session/session-record-registry';
import type { CorpusAttribution } from './lineage-attribution';
import {
  attributeCorpus,
  hasHiddenPrefix,
  pathToLeaf,
  settledWithProvider,
} from './lineage-attribution';
import type { ConversationTurnService } from './turn-service';
import { TERMINAL_TURN_STATES } from './turn-service';

/** What `branchHistory` needs: the provider history and the adapter-opaque cut inside it, plus
 * the turn's cut on the current history should the provider no longer honour the first. */
export type ForkCut = HistoryBranchCut;

/**
 * Resolves provider fork cuts from per-turn bindings — live-captured at turn end, or replayed
 * from a cold read of the active lineage under the same positional gate the projection renders
 * with. A cut is never guessed: no binding and no verified replay row means no fork.
 */
export class ConversationCheckpointService {
  constructor(
    private readonly turns: ConversationTurnService,
    private readonly records: SessionRecordRegistry,
    private readonly history: HistoryService,
  ) {}

  /** The cut that forks provider history right after `parentTurnId` ("before any child"). */
  forkCutAfter(
    record: SessionRecord,
    parentTurnId: TurnId,
  ): Effect.Effect<ForkCut | undefined, OperationError> {
    const { turns } = this;
    const boundCut = this.boundCut.bind(this);
    const replayCutBefore = this.replayCutBefore.bind(this);
    return Effect.gen(function* () {
      const sessionTurns = yield* turns.listTurns(record.sessionId);
      const parent = sessionTurns.find((turn) => turn.turnId === parentTurnId);
      if (!parent) return;
      const bound = yield* boundCut(record, parent);
      if (bound) return bound;
      const path = activePath(record, sessionTurns);
      const index = path.findIndex((turn) => turn.turnId === parentTurnId);
      if (index < 0 || index + 1 >= path.length) return;
      return yield* replayCutBefore(record, path, path[index + 1]);
    });
  }

  /** The cut that forks provider history right before `turnId`'s prompt ("after its parent"). */
  forkCutBefore(
    record: SessionRecord,
    turnId: TurnId,
  ): Effect.Effect<ForkCut | undefined, OperationError> {
    const { turns } = this;
    const boundCut = this.boundCut.bind(this);
    const replayCutBefore = this.replayCutBefore.bind(this);
    return Effect.gen(function* () {
      const sessionTurns = yield* turns.listTurns(record.sessionId);
      const turn = sessionTurns.find((candidate) => candidate.turnId === turnId);
      if (!turn) return;
      const parent = sessionTurns.find((candidate) => candidate.turnId === turn.parentTurnId);
      if (parent) {
        const bound = yield* boundCut(record, parent);
        if (bound) return bound;
      }
      return yield* replayCutBefore(record, activePath(record, sessionTurns), turn);
    });
  }

  /**
   * Attribute one lineage (`path` root→leaf, `contents` per path turn) to the provider history
   * that lineage wrote — the live history for the active lineage, an inactive lineage's own leaf
   * run history otherwise — under the §9 gate. Side effect: every attributed turn whose successor
   * row carries a provider cursor gains a `replay` binding on that history, unless a binding
   * already exists there — a live capture is never overwritten by a cold read.
   */
  attributeLineage(
    record: SessionRecord,
    path: readonly ConversationTurn[],
    contents: ReadonlyArray<ContentBlock[] | undefined>,
    historyId: AgentHistoryId | undefined,
  ): Effect.Effect<CorpusAttribution | undefined, OperationError> {
    const readCorpus = this.readCorpus.bind(this);
    const backfill = this.backfill.bind(this);
    return Effect.gen(function* () {
      const expectsProvider = settledWithProvider(path);
      if (historyId === undefined || expectsProvider.length === 0) return;
      const corpus = yield* readCorpus(record, historyId);
      if (corpus === undefined) return;
      const hostFingerprints: Array<string | undefined> = [];
      let liveFingerprint: string | undefined;
      for (let i = 0, len = path.length; i < len; i++) {
        const content = contents[i];
        if (!TERMINAL_TURN_STATES.has(path[i].state)) {
          if (content) liveFingerprint = promptContentFingerprint(content);
        } else if (path[i].state !== 'failed') {
          hostFingerprints.push(content && promptContentFingerprint(content));
        }
      }
      const attribution = attributeCorpus(
        corpus,
        hostFingerprints,
        liveFingerprint,
        // A failed turn may or may not have left provider rows, so the count behind the corpus
        // tail is unknowable: end-anchored alignment is off for that lineage.
        hasHiddenPrefix(record, path[0]) && !path.some((turn) => turn.state === 'failed'),
      );
      yield* backfill(expectsProvider, attribution, historyId);
      return attribution;
    });
  }

  /** The full provider corpus behind the TTL cache, or undefined when unreadable — unsupported
   * harness, failed read (an unforkable rollout), deleted transcript — so callers degrade to
   * prompt-only. */
  readCorpus(
    record: SessionRecord,
    historyId: AgentHistoryId,
  ): Effect.Effect<AgentHistoryEvent[] | undefined> {
    const { history } = this;
    const { cwd, kind, sessionId } = record;
    // A cached corpus captured before the newest settle can miss that turn's rows (or hold its
    // partial answer) — bypass it so a post-settle read never attributes a stale slice.
    const freshAfter = this.turns.lastSettledAt(sessionId);
    return Effect.gen(function* () {
      const events: AgentHistoryEvent[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        // cwd is load-bearing for codex: its rollout home resolves through the project env.
        const result = yield* history.read(kind, {
          historyId,
          cwd,
          cursor,
          freshAfter,
          limit: 1000,
        });
        for (let i = 0, len = result.events.length; i < len; i++) events.push(result.events[i]);
        cursor = result.cursor;
        if (cursor !== undefined) {
          if (seenCursors.has(cursor)) {
            return yield* Effect.fail(
              new OperationError({
                subsystem: 'agent',
                operation: 'conversation.read.history',
                publicMessage: 'Provider history read returned a repeated cursor',
                cause: undefined,
              }),
            );
          }
          seenCursors.add(cursor);
        }
      } while (cursor !== undefined);
      return events;
    }).pipe(
      Effect.catch((error) =>
        (error instanceof OperationError
          ? Effect.logWarning(
              'Provider history unavailable for conversation read',
              { sessionId, operation: error.operation },
              error.cause,
            )
          : Effect.void
        ).pipe(Effect.as(undefined)),
      ),
    );
  }

  /** `parent`'s persisted binding: the history its own run wrote to first (the live capture), the
   * current history's — the one known to be alive — behind it as the fallback, or as the pick when
   * the own run captured none. */
  private boundCut(
    record: SessionRecord,
    parent: ConversationTurn,
  ): Effect.Effect<ForkCut | undefined, OperationError> {
    return this.turns.listBindings(parent.turnId).pipe(
      Effect.map((bindings) => {
        const own = record.runs.find((run) => run.runId === parent.runId)?.historyId;
        const current = this.records.historyId(record.sessionId);
        const onOwn = bindings.find((binding) => binding.historyId === own);
        const onCurrent = bindings.find((binding) => binding.historyId === current);
        const pick = onOwn ?? onCurrent ?? bindings.at(0);
        if (pick === undefined) return;
        return {
          ...toCut(pick),
          ...(onCurrent !== undefined && onCurrent !== pick && { fallback: toCut(onCurrent) }),
        };
      }),
    );
  }

  /** Replay: `target`'s own user row on the active lineage carries the provider cursor that forks
   * right before it. Only the active lineage aligns positionally (§9); a target off it shares its
   * predecessor with the path's turn under the same parent ("before T" is "after parent(T)"), so
   * that sibling's row names the same cut on the current history. */
  private replayCutBefore(
    record: SessionRecord,
    path: ConversationTurn[],
    target: ConversationTurn,
  ): Effect.Effect<ForkCut | undefined, OperationError> {
    const { records, turns } = this;
    const attributeLineage = this.attributeLineage.bind(this);
    return Effect.gen(function* () {
      const anchor =
        path.find((turn) => turn.turnId === target.turnId) ??
        path.find((turn) => turn.parentTurnId === target.parentTurnId);
      if (anchor === undefined) return;
      const contents: Array<ContentBlock[] | undefined> = [];
      for (let i = 0, len = path.length; i < len; i++) {
        contents.push(yield* turns.hostUserContent(path[i]));
      }
      const historyId = records.historyId(record.sessionId);
      const attribution = yield* attributeLineage(record, path, contents, historyId);
      if (attribution === undefined || historyId === undefined) return;
      const position = settledWithProvider(path).findIndex((turn) => turn.turnId === anchor.turnId);
      const row =
        position >= 0
          ? attribution.attributed[position]?.userRow
          : TERMINAL_TURN_STATES.has(anchor.state)
            ? undefined
            : attribution.trailingLive;
      const cursor = row?.event.type === 'user-message' ? row.event.branchCursor : undefined;
      return cursor === undefined ? undefined : { historyId, cursor };
    });
  }

  private backfill(
    expectsProvider: readonly ConversationTurn[],
    attribution: CorpusAttribution,
    historyId: AgentHistoryId,
  ): Effect.Effect<void, OperationError> {
    const { turns } = this;
    return Effect.gen(function* () {
      const { attributed, trailingLive } = attribution;
      for (let j = 0, len = attributed.length; j < len; j++) {
        const successor = j + 1 < len ? attributed[j + 1].userRow : trailingLive;
        const cursor =
          successor?.event.type === 'user-message' ? successor.event.branchCursor : undefined;
        if (cursor === undefined) continue;
        const turn = expectsProvider[j];
        const existing = yield* turns.listBindings(turn.turnId);
        if (existing.some((binding) => binding.historyId === historyId)) continue;
        yield* turns.saveReplayBinding({
          turnId: turn.turnId,
          runId: turn.runId,
          historyId,
          checkpoint: cursor,
          capturedFrom: 'replay',
        });
      }
    });
  }
}

function toCut(binding: ProviderTurnBinding): AgentHistoryBranchOptions {
  return { historyId: asHistoryId(binding.historyId), cursor: binding.checkpoint };
}

function activePath(record: SessionRecord, turns: ConversationTurn[]): ConversationTurn[] {
  return pathToLeaf(new Map(turns.map((turn) => [turn.turnId, turn])), record.activeLeafTurnId);
}
