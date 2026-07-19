import type { AgentHistoryId, AgentHistorySession, AgentKind, SessionId } from '@linkcode/schema';
import { importSession, listHistory } from '@linkcode/sdk';
import { useMemo, useState } from 'react';
import { useData, useMutation } from '../runtime/tayori';

/** Single page, newest first; add cursor pagination when a provider actually overflows this. */
const HISTORY_PAGE_LIMIT = 200;

export interface ProviderHistory {
  /** Provider-local sessions across every project, most recent first. */
  entries: AgentHistorySession[];
  /** The provider returned a cursor — history continues beyond the fetched page. */
  hasMore: boolean;
  isLoading: boolean;
  /** The list fetch failure (e.g. "history list is not supported" for agents without it). */
  loadError: unknown;
  refresh: () => void;
  /** The entry currently importing, if any. */
  importingId: AgentHistoryId | null;
  /** The most recent import failure; cleared when the next import starts. */
  importError: unknown;
  /** Imports the entry as a cold session and resolves with its Link Code session id. */
  importEntry: (entry: AgentHistorySession) => Promise<SessionId>;
}

/** Global (cwd-less) provider history for one agent kind, plus the import mutation. */
export function useProviderHistory(kind: AgentKind): ProviderHistory {
  const { data, isLoading, error, mutate } = useData(listHistory, {
    agentKind: kind,
    opts: { limit: HISTORY_PAGE_LIMIT },
  });
  const importMutation = useMutation(importSession);
  const [importingId, setImportingId] = useState<AgentHistoryId | null>(null);
  const [importError, setImportError] = useState<unknown>(null);

  // Switching provider must not carry the previous provider's import state over — reset during
  // render (the sanctioned adjust-state-on-prop-change pattern; an effect would flash it stale).
  const [stateKind, setStateKind] = useState(kind);
  if (stateKind !== kind) {
    setStateKind(kind);
    setImportingId(null);
    setImportError(null);
  }

  const entries = useMemo(
    () =>
      [...(data?.sessions ?? [])].sort(
        (a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
      ),
    [data],
  );

  function importEntry(entry: AgentHistorySession): Promise<SessionId> {
    setImportingId(entry.historyId);
    setImportError(null);
    return importMutation
      .trigger({ agentKind: entry.kind, historyId: entry.historyId })
      .then((record) => record.sessionId)
      .catch((err: unknown) => {
        setImportError(err);
        throw err;
      })
      .finally(() => setImportingId(null));
  }

  return {
    entries,
    hasMore: data?.cursor != null,
    isLoading,
    loadError: error,
    refresh() {
      void mutate();
    },
    importingId,
    importError,
    importEntry,
  };
}
