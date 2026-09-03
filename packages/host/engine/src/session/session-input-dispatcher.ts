import { UnsupportedAttachmentError } from '@linkcode/agent-adapter';
import type { AgentInput, SessionId } from '@linkcode/schema';
import {
  agentCommandMatches,
  effectiveAttachmentCapability,
  userRowMessageId,
} from '@linkcode/schema';
import { Cause, Effect, Exit } from 'effect';
import { nullthrow } from 'foxts/guard';
import { assertInlineAttachmentsSupported } from '../attachment/admit';
import type { ConversationTurnService, PersistedTurnIntent } from '../conversation/turn-service';
import { mintOperationId, promptBlocksFromContent } from '../conversation/turn-service';
import { causeToRequestFailure, OperationError, RequestError } from '../failure';
import type { ResourceService } from '../resource/service';
import { RESOURCE_CONTEXT_SENTINEL } from '../resource/service';
import { assertAttachmentContentAllowed } from './attachment-guard';
import type { LiveSession } from './live-session';
import type { SessionEventProcessor } from './session-event-processor';
import type { SessionRecordRegistry } from './session-record-registry';

/** Validates and dispatches client input while preserving turn and response state transitions. */
export class SessionInputDispatcher {
  constructor(
    private readonly records: SessionRecordRegistry,
    private readonly events: SessionEventProcessor,
    private readonly resources: ResourceService,
    private readonly turns: ConversationTurnService,
  ) {}

  /** `prepared` is a submit-saga intent already persisted for this dispatch; without one, a
   * turn-starting legacy input persists its own plain-send intent — the graph misses no turns. */
  send(
    sessionId: SessionId,
    session: LiveSession,
    input: AgentInput,
    prepared?: PersistedTurnIntent,
    adapterOverride?: AgentInput,
  ): Effect.Effect<void, unknown> {
    const startsTurn =
      input.type === 'prompt' || input.type === 'command' || input.type === 'shell-command';
    if (
      input.type === 'command' &&
      (!session.capabilities.slashCommands ||
        !session.availableCommands?.some((command) => agentCommandMatches(command, input.name)))
    ) {
      const error = new RequestError({
        code: 'unsupported',
        message: `Unknown slash command: /${input.name}`,
        reportedInConversation: true,
      });
      this.events.rejectInput(sessionId, session, error.message);
      return Effect.fail(error);
    }
    if (input.type === 'shell-command' && !session.capabilities.shellCommand) {
      const error = new RequestError({
        code: 'unsupported',
        message: 'Shell commands are not supported by this session',
        reportedInConversation: true,
      });
      this.events.rejectInput(sessionId, session, error.message);
      return Effect.fail(error);
    }
    if (startsTurn && session.turnInputActive) {
      const error = new RequestError({
        code: 'conflict',
        message: `Session is busy: ${sessionId}`,
        reportedInConversation: true,
      });
      this.events.rejectInput(sessionId, session, error.message);
      return Effect.fail(error);
    }
    const { events, records, resources, turns } = this;
    // Set synchronously, before the first await, so a same-tick second turn input cannot slip
    // past the gate above while this one is still validating; every failure exit releases it.
    if (startsTurn) session.turnInputActive = true;
    return Effect.gen(function* () {
      // A submit operation in flight owns the session; legacy inputs respect the same admit gate.
      if (startsTurn && prepared === undefined && (yield* turns.hasOpenOperation(sessionId))) {
        const error = new RequestError({
          code: 'busy',
          message: `Session is busy: ${sessionId}`,
          reportedInConversation: true,
        });
        events.rejectInput(sessionId, session, error.message);
        return yield* Effect.fail(error);
      }
      let adapterInput: AgentInput = adapterOverride ?? input;
      if (input.type === 'prompt') {
        yield* Effect.try({
          try() {
            assertAttachmentContentAllowed(input.content);
            assertInlineAttachmentsSupported(
              input.content,
              effectiveAttachmentCapability(records.get(sessionId)?.kind ?? session.adapter.kind),
            );
          },
          catch(error) {
            return error;
          },
        });
        const promptForAdapter = adapterInput.type === 'prompt' ? adapterInput : input;
        adapterInput = yield* resources.readySourceLocators(sessionId).pipe(
          Effect.map((locators) =>
            locators.length === 0
              ? promptForAdapter
              : {
                  ...promptForAdapter,
                  content: [
                    ...promptForAdapter.content,
                    {
                      type: 'text' as const,
                      text: `${RESOURCE_CONTEXT_SENTINEL}\n${locators.join('\n')}`,
                    },
                  ],
                },
          ),
        );
      }
      // The durable commit point precedes the irreversible dispatch: kill or failure past here
      // leaves a `failed` turn, never an absent one.
      let intent = prepared;
      if (startsTurn && intent === undefined) {
        intent = yield* turns.persistIntent({
          sessionId,
          operationId: mintOperationId(),
          runId: session.runId,
          parentTurnId: records.get(sessionId)?.activeLeafTurnId ?? null,
          input:
            input.type === 'prompt'
              ? { type: 'prompt', blocks: promptBlocksFromContent(input.content) }
              : input,
        });
      }
      const persisted = intent;
      const persistedTurnId = startsTurn
        ? nullthrow(persisted, 'turn input without a persisted turn').turn.turnId
        : undefined;
      // The echo carries the durable row's identity: a client's live view and its later
      // conversation.read converge on one row per turn instead of reconciling two ids.
      const echoMessageId =
        persistedTurnId === undefined ? undefined : userRowMessageId(persistedTurnId);
      const dispatch = Effect.gen(function* () {
        // Echo before awaiting send: provider events can outrun the dispatch acknowledgement.
        if (persistedTurnId !== undefined && echoMessageId !== undefined) {
          if (input.type === 'prompt') {
            events.broadcast(
              sessionId,
              session,
              session.trackPrompt(echoMessageId, input.content, persistedTurnId),
            );
            records.setTitleFromContent(sessionId, input.content);
          } else if (input.type === 'command' || input.type === 'shell-command') {
            const text =
              input.type === 'command'
                ? `/${input.name}${input.arguments ? ` ${input.arguments}` : ''}`
                : `$ ${input.command}`;
            events.broadcast(
              sessionId,
              session,
              session.trackPrompt(echoMessageId, [{ type: 'text', text }], persistedTurnId),
            );
          }
        }
        const responseInput =
          input.type === 'permission-response' || input.type === 'question-response'
            ? input
            : undefined;
        const respondingAsk = responseInput
          ? session.interactions.beginResponse(responseInput)
          : undefined;
        if (responseInput && respondingAsk) {
          events.broadcast(sessionId, session, [
            {
              type: 'prompt-response-status',
              requestId: responseInput.requestId,
              status: 'responding',
            },
          ]);
        }
        yield* Effect.tryPromise({
          try: () => session.adapter.send(adapterInput),
          catch: (cause) =>
            cause instanceof UnsupportedAttachmentError
              ? new RequestError({
                  code: 'unsupported_attachment',
                  message: cause.message,
                  reportedInConversation: true,
                })
              : new OperationError({
                  subsystem: 'agent',
                  operation: 'session.input',
                  publicMessage: 'Agent input was rejected',
                  cause,
                  ...(startsTurn && { reportedInConversation: true }),
                }),
        }).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              if (responseInput && respondingAsk) {
                events.broadcast(
                  sessionId,
                  session,
                  session.interactions.restoreResponse(responseInput.requestId, respondingAsk),
                );
              }
              if (echoMessageId !== undefined) session.untrackPrompt(echoMessageId);
              if (startsTurn) {
                events.rejectInput(
                  sessionId,
                  session,
                  error instanceof RequestError ? error.message : error.publicMessage,
                );
              }
            }),
          ),
        );
        if (responseInput && respondingAsk) {
          const resolution = session.interactions.resolveResponse(responseInput, respondingAsk);
          if (resolution) events.broadcast(sessionId, session, [resolution]);
        }
        // The provider accepted the dispatch: the turn flips to running and the default leaf moves.
        if (persisted !== undefined) yield* turns.commitRunning(persisted);
        // Synchronous controls may not produce lifecycle events; only a running turn keeps the gate.
        if (startsTurn && session.status !== 'running') session.turnInputActive = false;
      });
      // A saga-prepared intent is resolved by its saga's own exit backstop in the request fiber;
      // this fiber resolves only the intents it minted, so the saga's precise error (e.g. the
      // dispatch timeout) can never lose the store race to this fiber's interrupt exit.
      if (persisted === undefined || prepared !== undefined) return yield* dispatch;
      // Every non-success exit past the durable commit point — dispatch rejection, commit failure,
      // interrupt, defect — must resolve the operation, or the session wedges `busy`.
      return yield* dispatch.pipe(
        Effect.onExit((exit) => {
          if (!Exit.isFailure(exit)) return Effect.void;
          const failure = causeToRequestFailure(exit.cause);
          // An interrupt exit means the session scope is tearing down, and awaiting store hops in
          // this finalizer would block Scope.close — that one path stays detached.
          if (Cause.hasInterruptsOnly(exit.cause)) {
            return Effect.sync(() => {
              turns.resolveFailedDetached(persisted, failure);
            });
          }
          // Typed failures await, so the failure reply can never beat the stored resolution and
          // hand an instant retry a spurious `busy`.
          return turns.resolveFailed(persisted, failure).pipe(
            Effect.catch((resolveError) =>
              Effect.logError(
                'Failed to record the rejected turn',
                { sessionId },
                resolveError.cause,
              ),
            ),
            Effect.asVoid,
          );
        }),
      );
    }).pipe(
      Effect.onExit((exit) =>
        startsTurn && Exit.isFailure(exit)
          ? Effect.sync(() => {
              // A failed or interrupted dispatch can exit before a lifecycle event releases it.
              if (session.status !== 'running') session.turnInputActive = false;
            })
          : Effect.void,
      ),
    );
  }
}
