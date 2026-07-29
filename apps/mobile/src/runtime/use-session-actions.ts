import { useLinkCodeClient } from '@linkcode/client-core';
import type {
  PermissionOutcome,
  QuestionOutcome,
  SessionId,
  SessionStatus,
} from '@linkcode/schema';
import { useSet } from 'foxact/use-set';
import { useCallback, useState } from 'react';

/** Which composer action failed. Failures carry no message: the daemon's reasons are not
 * user-actionable here, and the caller owns the copy. */
export type SessionActionFailure = 'send' | 'stop';

export interface SessionActions {
  /** The turn is in flight, so the composer's single action should read as stop, not send. */
  readonly isRunning: boolean;
  /** False when there is no live session to prompt — a cold or stopped thread. */
  readonly canCompose: boolean;
  readonly failure: SessionActionFailure | null;
  /** Ask ids with a response in flight. */
  readonly respondingIds: ReadonlySet<string>;
  /** Ask ids whose last response failed. */
  readonly failedResponseIds: ReadonlySet<string>;
  readonly send: (text: string) => void;
  readonly stop: () => void;
  readonly respondPermission: (requestId: string, outcome: PermissionOutcome) => void;
  readonly respondQuestion: (requestId: string, outcome: QuestionOutcome) => void;
}

/** Everything a conversation surface needs to drive a session: prompt, cancel, and answer
 * permission / question asks. Fire-and-forget by design — the daemon's `agent.event` stream is the
 * single source of truth for what actually happened, so these only track in-flight and failed
 * attempts. A null `sessionId` makes every action a no-op instead of throwing. */
export function useSessionActions(
  sessionId: SessionId | null,
  status: SessionStatus | null,
): SessionActions {
  const client = useLinkCodeClient();
  const [respondingIds, addResponding, removeResponding] = useSet<string>();
  const [failedResponseIds, addFailedResponse, removeFailedResponse] = useSet<string>();
  const [failure, setFailure] = useState<SessionActionFailure | null>(null);

  const send = useCallback(
    (text: string) => {
      if (!sessionId) return;
      setFailure(null);
      client.promptText(sessionId, text).catch(() => setFailure('send'));
    },
    [client, sessionId],
  );

  const stop = useCallback(() => {
    if (!sessionId) return;
    client.cancel(sessionId).catch(() => setFailure('stop'));
  }, [client, sessionId]);

  const respond = useCallback(
    (requestId: string, send_: () => Promise<unknown>) => {
      removeFailedResponse(requestId);
      addResponding(requestId);
      send_()
        .catch(() => addFailedResponse(requestId))
        .finally(() => removeResponding(requestId));
    },
    [addFailedResponse, addResponding, removeFailedResponse, removeResponding],
  );

  const respondPermission = useCallback(
    (requestId: string, outcome: PermissionOutcome) => {
      if (!sessionId) return;
      respond(requestId, () => client.respondPermission(sessionId, requestId, outcome));
    },
    [client, respond, sessionId],
  );

  const respondQuestion = useCallback(
    (requestId: string, outcome: QuestionOutcome) => {
      if (!sessionId) return;
      respond(requestId, () => client.respondQuestion(sessionId, requestId, outcome));
    },
    [client, respond, sessionId],
  );

  return {
    isRunning: status === 'running' || status === 'starting',
    canCompose: sessionId !== null && status !== null && status !== 'stopped',
    failure,
    respondingIds,
    failedResponseIds,
    send,
    stop,
    respondPermission,
    respondQuestion,
  };
}
