import type { AgentInput, SessionId } from '@linkcode/schema';
import { agentCommandMatches } from '@linkcode/schema';
import { Effect } from 'effect';
import { OperationError, RequestError } from '../failure';
import { assertAttachmentContentAllowed } from './attachment-guard';
import type { LiveSession } from './live-session';
import type { SessionEventProcessor } from './session-event-processor';
import type { SessionRecordRegistry } from './session-record-registry';

/** Validates and dispatches client input while preserving turn and response state transitions. */
export class SessionInputDispatcher {
  constructor(
    private readonly records: SessionRecordRegistry,
    private readonly events: SessionEventProcessor,
  ) {}

  send(
    sessionId: SessionId,
    session: LiveSession,
    input: AgentInput,
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
      });
      this.events.rejectInput(sessionId, error.message);
      return Effect.fail(error);
    }
    if (input.type === 'shell-command' && !session.capabilities.shellCommand) {
      const error = new RequestError({
        code: 'unsupported',
        message: 'Shell commands are not supported by this session',
      });
      this.events.rejectInput(sessionId, error.message);
      return Effect.fail(error);
    }
    if (startsTurn && session.turnInputActive) {
      const error = new RequestError({
        code: 'conflict',
        message: `Session is busy: ${sessionId}`,
      });
      this.events.rejectInput(sessionId, error.message);
      return Effect.fail(error);
    }
    const { events, records } = this;
    return Effect.gen(function* () {
      if (startsTurn) session.turnInputActive = true;
      // Echo before awaiting send: provider events can outrun the dispatch acknowledgement.
      if (input.type === 'prompt') {
        yield* Effect.try({
          try: () => assertAttachmentContentAllowed(input.content),
          catch: (e) => e,
        });
        events.broadcast(sessionId, [{ type: 'user-message', content: input.content }]);
        records.setTitleFromContent(sessionId, input.content);
      } else if (input.type === 'command' || input.type === 'shell-command') {
        const text =
          input.type === 'command'
            ? `/${input.name}${input.arguments ? ` ${input.arguments}` : ''}`
            : `$ ${input.command}`;
        events.broadcast(sessionId, [{ type: 'user-message', content: [{ type: 'text', text }] }]);
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
        try: () => session.adapter.send(input),
        catch: (cause) =>
          new OperationError({
            subsystem: 'agent',
            operation: 'session.input',
            publicMessage: 'Agent input was rejected',
            cause,
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
            if (startsTurn && session.status !== 'running') session.turnInputActive = false;
            if (startsTurn) events.rejectInput(sessionId, error.publicMessage);
          }).pipe(Effect.andThen(Effect.fail(error))),
        ),
      );
      if (responseInput && respondingAsk) {
        const resolution = session.interactions.resolveResponse(responseInput, respondingAsk);
        if (resolution) events.broadcast(sessionId, [resolution]);
      }
      // Synchronous controls may not produce lifecycle events; only a running turn keeps the gate.
      if (startsTurn && session.status !== 'running') session.turnInputActive = false;
    });
  }
}
