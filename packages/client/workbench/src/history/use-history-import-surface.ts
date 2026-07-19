import type { AgentHistoryId, AgentKind } from '@linkcode/schema';
import type { HistoryBrowserEntry, HistorySortOrder } from '@linkcode/ui';
import { AGENT_LABELS, sortHistoryBrowserEntries } from '@linkcode/ui';
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
  importingIds: ReadonlySet<AgentHistoryId>;
  importingCwds: ReadonlySet<string>;
  /** Per-entry failures stay attached to the rows that did not import. */
  importErrors: ReadonlyMap<AgentHistoryId, string>;
  groupImportFailures: ReadonlyMap<string, { imported: number; total: number }>;
  actionError: string | null;
  refresh: () => void;
  /** Imports the entry as a cold session; the dedup badge flips on list revalidation. */
  importEntry: (historyId: AgentHistoryId) => void;
  /** Imports every not-yet-imported entry in a directory after registering it as a project. */
  importGroup: (cwd: string, historyIds: readonly AgentHistoryId[]) => void;
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
  const [openError, setOpenError] = useState<{ kind: AgentKind; error: unknown } | null>(null);
  const [importErrorsByKey, setImportErrorsByKey] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [groupImportFailuresByKey, setGroupImportFailuresByKey] = useState<
    ReadonlyMap<string, { imported: number; total: number }>
  >(() => new Map());
  const sessions = useWorkbenchSessions((error) => setOpenError({ kind, error }));

  const imported = importedSessionByHistoryId(sessions.sessions);
  const importErrors = new Map<AgentHistoryId, string>();
  const groupImportFailures = new Map<string, { imported: number; total: number }>();
  for (const entry of history.entries) {
    const entryError = importErrorsByKey.get(historyStateKey(entry.kind, entry.historyId));
    if (entryError !== undefined) importErrors.set(entry.historyId, entryError);
    if (!entry.cwd) continue;
    const groupKey = historyStateKey(kind, entry.cwd);
    const groupFailure = groupImportFailuresByKey.get(groupKey);
    if (groupFailure !== undefined) groupImportFailures.set(entry.cwd, groupFailure);
  }
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
    const key = historyStateKey(entry.kind, historyId);
    setImportErrorsByKey((current) => withoutMapKey(current, key));
    // The dedup badge flips once the revalidated session list carries the imported origin.
    void history
      .importEntry(entry)
      .then(() => sessions.refresh())
      .catch((error: unknown) => {
        setImportErrorsByKey((current) => new Map(current).set(key, errorMessage(error)));
      });
  }

  function importGroup(cwd: string, historyIds: readonly AgentHistoryId[]): void {
    const requested = new Set(historyIds);
    const entriesToImport = history.entries.filter(
      (entry) =>
        requested.has(entry.historyId) &&
        !imported.has(importedSessionKey(entry.kind, entry.historyId)),
    );
    if (entriesToImport.length === 0) return;

    const groupKey = historyStateKey(kind, cwd);
    const entryKeys = entriesToImport.map((entry) => historyStateKey(entry.kind, entry.historyId));
    setGroupImportFailuresByKey((current) => withoutMapKey(current, groupKey));
    setImportErrorsByKey((current) => withoutMapKeys(current, entryKeys));
    void history.importGroup(cwd, entriesToImport).then((result) => {
      if (!result) return;
      sessions.refresh();
      if (result.failures.length === 0) return;
      setImportErrorsByKey((current) => {
        const next = new Map(current);
        for (const failure of result.failures) {
          next.set(historyStateKey(kind, failure.historyId), errorMessage(failure.error));
        }
        return next;
      });
      setGroupImportFailuresByKey((current) =>
        new Map(current).set(groupKey, {
          imported: result.imported.length,
          total: entriesToImport.length,
        }),
      );
    });
  }

  function openEntry(historyId: AgentHistoryId): void {
    const entry = entryById(historyId);
    if (!entry) return;
    const existing = imported.get(importedSessionKey(entry.kind, entry.historyId));
    // The dedup map is built from the same session list select() resumes against, so the id is
    // always in-list here; select() wakes it if cold and lowers the overlay.
    if (existing !== undefined) {
      setOpenError(null);
      sessions.select(existing);
    }
  }

  return {
    entries,
    count: entries.length,
    truncated: history.hasMore,
    isLoading: history.isLoading,
    loadError:
      history.loadError == null ? null : (extractErrorMessage(history.loadError, false) ?? ''),
    importingIds: history.importingIds,
    importingCwds: history.importingCwds,
    importErrors,
    groupImportFailures,
    actionError: openError?.kind === kind ? errorMessage(openError.error) : null,
    refresh() {
      // Both keys: the imported badges derive from the session list, so refreshing only the
      // provider history would leave the dedup map stale (and re-offer Import on imported rows).
      history.refresh();
      sessions.refresh();
    },
    importEntry,
    importGroup,
    openEntry,
  };
}

function errorMessage(error: unknown): string {
  return extractErrorMessage(error, false) ?? '';
}

function historyStateKey(kind: AgentKind, value: string): string {
  return `${kind}\0${value}`;
}

function withoutMapKey<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

function withoutMapKeys<K, V>(map: ReadonlyMap<K, V>, keys: readonly K[]): ReadonlyMap<K, V> {
  if (!keys.some((key) => map.has(key))) return map;
  const next = new Map(map);
  for (const key of keys) next.delete(key);
  return next;
}
