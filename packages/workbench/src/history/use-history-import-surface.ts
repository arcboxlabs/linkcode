import type { AgentHistoryId, AgentKind } from '@linkcode/schema';
import type { HistoryBrowserEntry, HistorySortOrder } from '@linkcode/ui';
import { AGENT_LABELS, sortHistoryBrowserEntries } from '@linkcode/ui';
import { noop } from 'foxact/noop';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useState } from 'react';
import { useWorkbenchSessions } from '../surface/use-workbench-sessions';
import { importedSessionByHistoryId, importedSessionKey } from './imported';
import { useProviderHistory } from './use-provider-history';

export interface HistoryImportSurface {
  /** Dedup-annotated view models in the requested order — feeds the list. */
  entries: HistoryBrowserEntry[];
  /** Loaded entry count — feeds the host's heading. */
  count: number;
  /** The provider returned another page beyond the fetched one — the list is not the full history. */
  truncated: boolean;
  isLoading: boolean;
  loadError: string | null;
  importingId: AgentHistoryId | null;
  /** The most recent import/open failure, cleared on the next attempt or provider switch. */
  importError: string | null;
  refresh: () => void;
  /** Imports the entry as a cold session; the dedup badge flips on list revalidation. */
  importEntry: (historyId: AgentHistoryId) => void;
  /** Selects an already-imported entry's session (resuming it cold); the list only offers Open
   * once imported, so there is no import-on-open path. */
  openEntry: (historyId: AgentHistoryId) => void;
}

/**
 * Headless container for the history import surface, feeding both the host's chrome controls and
 * the conversation list. A second `useWorkbenchSessions` instance is safe here: the session list
 * rides one shared SWR key and selection/navigation live in module-scope stores.
 */
export function useHistoryImportSurface(
  kind: AgentKind,
  sort: HistorySortOrder,
): HistoryImportSurface {
  const history = useProviderHistory(kind);
  const [openError, setOpenError] = useState<unknown>(null);
  const sessions = useWorkbenchSessions(setOpenError);

  // Switching provider must not carry the previous pane's failure over — reset during render
  // (the sanctioned adjust-state-on-prop-change pattern; an effect would flash the stale error).
  const [errorKind, setErrorKind] = useState(kind);
  if (errorKind !== kind) {
    setErrorKind(kind);
    setOpenError(null);
  }

  const imported = importedSessionByHistoryId(sessions.sessions);
  const entries = sortHistoryBrowserEntries(
    history.entries.map((entry) => ({
      historyId: entry.historyId,
      title: entry.title ?? AGENT_LABELS[entry.kind],
      // The schema allows an empty-string cwd; normalize so it lands in the no-project bucket
      // instead of rendering a blank group label.
      cwd: entry.cwd || undefined,
      timestamp: entry.updatedAt ?? entry.createdAt,
      messageCount: entry.messageCount,
      imported: imported.has(importedSessionKey(entry.kind, entry.historyId)),
    })),
    sort,
  );

  function entryById(historyId: AgentHistoryId) {
    return history.entries.find((entry) => entry.historyId === historyId);
  }

  function importEntry(historyId: AgentHistoryId): void {
    const entry = entryById(historyId);
    if (!entry) return;
    // The dedup badge flips once the revalidated session list carries the imported origin.
    void history
      .importEntry(entry)
      .then(() => sessions.refresh())
      .catch(noop);
  }

  function openEntry(historyId: AgentHistoryId): void {
    const entry = entryById(historyId);
    if (!entry) return;
    const existing = imported.get(importedSessionKey(entry.kind, entry.historyId));
    // The dedup map is built from the same session list select() resumes against, so the id is
    // always in-list here; select() wakes it if cold and lowers the overlay.
    if (existing !== undefined) sessions.select(existing);
  }

  const inlineError = history.importError ?? openError;
  return {
    entries,
    count: entries.length,
    truncated: history.hasMore,
    isLoading: history.isLoading,
    loadError:
      history.loadError == null ? null : (extractErrorMessage(history.loadError, false) ?? ''),
    importingId: history.importingId,
    importError: inlineError == null ? null : (extractErrorMessage(inlineError, false) ?? ''),
    refresh() {
      // Both keys: the imported badges derive from the session list, so refreshing only the
      // provider history would leave the dedup map stale (and re-offer Import on imported rows).
      history.refresh();
      sessions.refresh();
    },
    importEntry,
    openEntry,
  };
}
