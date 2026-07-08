import type { AgentHistorySession, SessionId } from '@linkcode/schema';
import { importSession, listHistory } from '@linkcode/sdk';
import { HistoryList } from '@linkcode/ui';
import { noop } from 'foxact/noop';
import { useState } from 'react';
import { useData, useMutation } from '../runtime/tayori';

/**
 * Provider-local history across every agent kind for one workspace `cwd`, merged and sorted most
 * recent first. `listHistory` is scoped to a single agent kind, so this fans out one fetch per
 * kind — one `useData` call each, so the set is fixed here (a dynamic loop would break the rules
 * of hooks) and MUST be extended by hand when `AgentKindSchema` gains a history-list-capable kind.
 * Kinds without history support (opencode/pi today) simply return empty and cost one no-op fetch.
 */
function useWorkspaceHistory(cwd: string, onImported: (sessionId: SessionId) => void) {
  const claudeCode = useData(listHistory, { agentKind: 'claude-code', opts: { cwd } });
  const codex = useData(listHistory, { agentKind: 'codex', opts: { cwd } });
  const opencode = useData(listHistory, { agentKind: 'opencode', opts: { cwd } });
  const pi = useData(listHistory, { agentKind: 'pi', opts: { cwd } });
  const amp = useData(listHistory, { agentKind: 'amp', opts: { cwd } });
  const importMutation = useMutation(importSession);
  const [importingHistoryId, setImportingHistoryId] = useState<string | null>(null);

  const results = [claudeCode, codex, opencode, pi, amp];
  const entries = results
    .flatMap((result) => result.data?.sessions ?? [])
    .sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));

  function importEntry(entry: AgentHistorySession): void {
    setImportingHistoryId(entry.historyId);
    void importMutation
      .trigger({ agentKind: entry.kind, historyId: entry.historyId })
      .then((record) => onImported(record.sessionId))
      .catch(noop)
      .finally(() => setImportingHistoryId(null));
  }

  const isLoading = results.some((result) => result.isLoading);
  const loadFailed =
    entries.length === 0 && !isLoading && results.every((result) => result.error != null);

  return {
    entries,
    isLoading,
    loadFailed,
    importingHistoryId,
    importError: importMutation.error,
    importEntry,
  };
}

export interface RuntimeWorkspaceHistoryProps {
  cwd: string;
  onImported: (sessionId: SessionId) => void;
}

/** Hook-backed adapter: the drilldown's "Import history" section for one workspace `cwd`. */
export function RuntimeWorkspaceHistory({
  cwd,
  onImported,
}: RuntimeWorkspaceHistoryProps): React.ReactNode {
  const { entries, isLoading, loadFailed, importingHistoryId, importError, importEntry } =
    useWorkspaceHistory(cwd, onImported);

  return (
    <HistoryList
      entries={entries}
      isLoading={isLoading}
      loadFailed={loadFailed}
      importingHistoryId={importingHistoryId}
      importError={importError}
      onImport={importEntry}
    />
  );
}
