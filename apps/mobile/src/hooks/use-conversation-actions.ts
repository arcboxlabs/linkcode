import { useLinkCodeClient } from '@linkcode/client-core';
import type { PermissionOutcome, QuestionOutcome, SessionId } from '@linkcode/schema';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { noop } from 'foxts/noop';
import { useState } from 'react';

export interface ConversationActions {
  /** Resolves false when the daemon rejected the prompt — the caller restores the draft. */
  send: (text: string) => Promise<boolean>;
  stop: () => void;
  /** `declined` marks reject-kind choices so an unsnapshotted call can render as failed. */
  respondPermission: (requestId: string, outcome: PermissionOutcome, declined: boolean) => void;
  respondQuestion: (requestId: string, outcome: QuestionOutcome) => void;
  copyText: (text: string) => void;
  /** Ask currently being answered (spinner state for the dock). */
  respondingRequestId?: string;
  respondingOptionId?: string;
  /** Asks answered in this client — hidden from the dock while the daemon settles them. */
  answeredRequestIds: readonly string[];
  /** Declined asks whose calls may never snapshot; the timeline shows them as failed rows. */
  declinedRequestIds: readonly string[];
}

/** Send/stop/respond/copy wired to the raw client, with haptic feedback on each action. */
export function useConversationActions(sessionId: SessionId | null): ConversationActions {
  const client = useLinkCodeClient();
  const [responding, setResponding] = useState<{ requestId: string; optionId?: string } | null>(
    null,
  );
  const [answeredRequestIds, setAnsweredRequestIds] = useState<readonly string[]>([]);
  const [declinedRequestIds, setDeclinedRequestIds] = useState<readonly string[]>([]);

  return {
    async send(text) {
      if (!sessionId) return false;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        await client.prompt(sessionId, [{ type: 'text', text }]);
        return true;
      } catch {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return false;
      }
    },
    stop() {
      if (!sessionId) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // A cancel race with turn end is benign; the status event settles the UI either way.
      client.cancel(sessionId).catch(noop);
    },
    respondPermission(requestId, outcome, declined) {
      if (!sessionId) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setResponding({
        requestId,
        optionId: outcome.outcome === 'selected' ? outcome.optionId : undefined,
      });
      client
        .respondPermission(sessionId, requestId, outcome)
        .then(() => {
          setAnsweredRequestIds((ids) => [...ids, requestId]);
          if (declined) setDeclinedRequestIds((ids) => [...ids, requestId]);
        })
        .catch(() => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        })
        .finally(() => setResponding(null));
    },
    respondQuestion(requestId, outcome) {
      if (!sessionId) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setResponding({ requestId });
      client
        .respondQuestion(sessionId, requestId, outcome)
        .then(() => setAnsweredRequestIds((ids) => [...ids, requestId]))
        .catch(() => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        })
        .finally(() => setResponding(null));
    },
    copyText(text) {
      void Clipboard.setStringAsync(text);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    respondingRequestId: responding?.requestId,
    respondingOptionId: responding?.optionId,
    answeredRequestIds,
    declinedRequestIds,
  };
}
