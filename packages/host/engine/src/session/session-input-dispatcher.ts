import { nextMessageId } from '@linkcode/agent-adapter';
import type { AgentInput, SessionId } from '@linkcode/schema';
import { agentCommandMatches } from '@linkcode/schema';
import { Effect } from 'effect';
import type { ConversationTurnService, PersistedTurnIntent } from '../conversation/turn-service';
import { mintOperationId, promptBlocksFromContent } from '../conversation/turn-service';
import { OperationError, RequestError, toRequestFailure } from '../failure';
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
      this.events.rejectInput(sessionId, error.message);
      return Effect.fail(error);
    }
    if (input.type === 'shell-command' && !session.capabilities.shellCommand) {
      const error = new RequestError({
        code: 'unsupported',
        message: 'Shell commands are not supported by this session',
        reportedInConversation: true,
      });
      this.events.rejectInput(sessionId, error.message);
      return Effect.fail(error);
    }
    if (startsTurn && session.turnInputActive) {
      const error = new RequestError({
        code: 'conflict',
        message: `Session is busy: ${sessionId}`,
        reportedInConversation: true,
      });
      this.events.rejectInput(sessionId, error.message);
      return Effect.fail(error);
    }
    const { events, records, resources, turns } = this;
    const promptMessageId = input.type === 'prompt' ? nextMessageId() : undefined;
    return Effect.gen(function* () {
      // A submit operation in flight owns the session; legacy inputs respect the same admit gate.
      if (startsTurn && prepared === undefined && (yield* turns.hasOpenOperation(sessionId))) {
        const error = new RequestError({
          code: 'busy',
          message: `Session is busy: ${sessionId}`,
          reportedInConversation: true,
        });
        events.rejectInput(sessionId, error.message);
        return yield* Effect.fail(error);
      }
      let adapterInput: AgentInput = input;
      if (input.type === 'prompt') {
        yield* Effect.try({
          try: () => assertAttachmentContentAllowed(input.content),
          catch: (e) => e,
        });
        adapterInput = yield* resources.readySourceLocators(sessionId).pipe(
          Effect.map((locators) =>
            locators.length === 0
              ? input
              : {
                  ...input,
                  content: [
                    ...input.content,
                    {
                      type: 'text' as const,
                      text: `${RESOURCE_CONTEXT_SENTINEL}\n${locators.join('\n')}`,
                    },
                  ],
                },
          ),
        );
      }
      if (startsTurn) session.turnInputActive = true;
      // The durable commit point precedes the irreversible dispatch: kill or failure past here
      // leaves a `failed` turn, never an absent one.
      let intent = prepared;
      if (startsTurn && intent === undefined) {
        intent = yield* turns
          .persistIntent({
            sessionId,
            operationId: mintOperationId(),
            runId: session.runId,
            parentTurnId: records.get(sessionId)?.activeLeafTurnId ?? null,
            input:
              input.type === 'prompt'
                ? { type: 'prompt', blocks: promptBlocksFromContent(input.content) }
                : input,
          })
          .pipe(
            Effect.tapError(() =>
              Effect.sync(() => {
                if (session.status !== 'running') session.turnInputActive = false;
              }),
            ),
          );
      }
      // Echo before awaiting send: provider events can outrun the dispatch acknowledgement.
      if (promptMessageId !== undefined && input.type === 'prompt') {
        events.broadcast(sessionId, session.trackPrompt(promptMessageId, input.content));
        records.setTitleFromContent(sessionId, input.content);
      } else if (input.type === 'command' || input.type === 'shell-command') {
        const text =
          input.type === 'command'
            ? `/${input.name}${input.arguments ? ` ${input.arguments}` : ''}`
            : `$ ${input.command}`;
        events.broadcast(sessionId, [
          {
            type: 'user-message',
            messageId: nextMessageId(),
            content: [{ type: 'text', text }],
          },
        ]);
      }
      const responseInput =
        input.type === 'permission-response' || input.type === 'question-response'
          ? input
          : undefined;
      const respondingAsk = responseInput
        ? session.interactions.beginResponse(responseInput)
        : undefined;
      if (responseInput && respondingAsk) {
        events.broadcast(sessionId, [
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
          new OperationError({
            subsystem: 'agent',
            operation: 'session.input',
            publicMessage: 'Agent input was rejected',
            cause,
            ...(startsTurn && { reportedInConversation: true }),
          }),
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            if (responseInput && respondingAsk) {
              events.broadcast(
                sessionId,
                session.interactions.restoreResponse(responseInput.requestId, respondingAsk),
              );
            }
            if (promptMessageId !== undefined) {
              events.broadcast(sessionId, session.untrackPrompt(promptMessageId));
            }
            if (startsTurn && session.status !== 'running') session.turnInputActive = false;
            if (startsTurn) events.rejectInput(sessionId, error.publicMessage);
          }).pipe(
            Effect.andThen(
              intent === undefined
                ? Effect.void
                : turns
                    .resolveFailed(intent, toRequestFailure(error))
                    .pipe(
                      Effect.catch((resolveError) =>
                        Effect.logError(
                          'Failed to record the rejected turn',
                          { sessionId },
                          resolveError.cause,
                        ),
                      ),
                    ),
            ),
            Effect.andThen(Effect.fail(error)),
          ),
        ),
      );
      if (responseInput && respondingAsk) {
        const resolution = session.interactions.resolveResponse(responseInput, respondingAsk);
        if (resolution) events.broadcast(sessionId, [resolution]);
      }
      // The provider accepted the dispatch: the turn flips to running and the default leaf moves.
      if (intent !== undefined) yield* turns.commitRunning(intent);
      // Synchronous controls may not produce lifecycle events; only a running turn keeps the gate.
      if (startsTurn && session.status !== 'running') session.turnInputActive = false;
    });
  }
}
