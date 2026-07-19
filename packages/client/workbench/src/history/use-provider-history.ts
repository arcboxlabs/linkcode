import type { AgentHistoryId, AgentHistorySession, AgentKind, SessionId } from '@linkcode/schema';
import { importSession, listHistory, listWorkspaces, registerWorkspace } from '@linkcode/sdk';
import { useMemo, useRef, useState } from 'react';
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
  /** Every entry currently importing; batch imports may contain several. */
  importingIds: ReadonlySet<AgentHistoryId>;
  /** Legacy single-entry state retained while consumers migrate to importingIds. */
  importingId: AgentHistoryId | null;
  importError: unknown;
  /** Directory groups currently importing. */
  importingCwds: ReadonlySet<string>;
  /** Imports the entry as a cold session and resolves with its Link Code session id. */
  importEntry: (entry: AgentHistorySession) => Promise<SessionId>;
  /** Registers the directory as a project and imports all entries; dedupes in-flight requests. */
  importGroup: (
    cwd: string,
    entries: readonly AgentHistorySession[],
  ) => Promise<HistoryGroupImportResult | null>;
}

export interface HistoryGroupImportFailure {
  historyId: AgentHistoryId;
  error: unknown;
}

export interface HistoryGroupImportResult {
  imported: AgentHistoryId[];
  failures: HistoryGroupImportFailure[];
}

interface ImportHistoryGroupOptions {
  cwd: string;
  inFlightKey?: string;
  entries: readonly AgentHistorySession[];
  inFlight: Set<string>;
  register: (cwd: string) => Promise<unknown>;
  importEntry: (entry: AgentHistorySession) => Promise<SessionId>;
}

export async function importHistoryGroup({
  cwd,
  inFlightKey = cwd,
  entries,
  inFlight,
  register,
  importEntry,
}: ImportHistoryGroupOptions): Promise<HistoryGroupImportResult | null> {
  if (inFlight.has(inFlightKey)) return null;
  inFlight.add(inFlightKey);
  try {
    // A directory-level action promises a project, so do not create orphaned imported sessions if
    // the directory cannot be registered. Registration is idempotent for an existing project.
    await register(cwd);
    const settled = await Promise.allSettled(entries.map((entry) => importEntry(entry)));
    const result: HistoryGroupImportResult = { imported: [], failures: [] };
    for (const [index, outcome] of settled.entries()) {
      const entry = entries[index];
      if (outcome.status === 'fulfilled') result.imported.push(entry.historyId);
      else result.failures.push({ historyId: entry.historyId, error: outcome.reason });
    }
    return result;
  } finally {
    inFlight.delete(inFlightKey);
  }
}

/** Global (cwd-less) provider history for one agent kind, plus the import mutation. */
export function useProviderHistory(kind: AgentKind): ProviderHistory {
  const { data, isLoading, error, mutate } = useData(
    listHistory,
    {
      agentKind: kind,
      opts: { limit: HISTORY_PAGE_LIMIT },
    },
    // Provider history is identity-scoped: retaining the previous key's rows would label one
    // agent's sessions as another agent's while the next scan is pending or unavailable.
    { keepPreviousData: false },
  );
  const { mutate: mutateWorkspaces } = useData(listWorkspaces, {});
  const importMutation = useMutation(importSession);
  const registerMutation = useMutation(registerWorkspace);
  const pendingImportsRef = useRef(new Map<string, Promise<SessionId>>());
  const pendingGroupsRef = useRef(new Set<string>());
  const [importingKeys, setImportingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [importingGroupKeys, setImportingGroupKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [importError, setImportError] = useState<unknown>(null);

  const entries = useMemo(
    () =>
      [...(data?.sessions ?? [])].sort(
        (a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
      ),
    [data],
  );

  function importEntry(entry: AgentHistorySession): Promise<SessionId> {
    const key = importKey(entry.kind, entry.historyId);
    const existing = pendingImportsRef.current.get(key);
    if (existing) return existing;

    setImportError(null);
    setImportingKeys((current) => new Set(current).add(key));
    const pending = importMutation
      .trigger({ agentKind: entry.kind, historyId: entry.historyId })
      .then((record) => record.sessionId)
      .catch((error: unknown) => {
        setImportError(error);
        throw error;
      })
      .finally(() => {
        pendingImportsRef.current.delete(key);
        setImportingKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      });
    pendingImportsRef.current.set(key, pending);
    return pending;
  }

  function importGroup(
    cwd: string,
    groupEntries: readonly AgentHistorySession[],
  ): Promise<HistoryGroupImportResult | null> {
    const key = importKey(kind, cwd);
    if (pendingGroupsRef.current.has(key)) return Promise.resolve(null);
    setImportingGroupKeys((current) => new Set(current).add(key));
    return importHistoryGroup({
      cwd,
      inFlightKey: key,
      entries: groupEntries,
      inFlight: pendingGroupsRef.current,
      register: (directory) =>
        registerMutation.trigger({ cwd: directory }).then((record) => {
          void mutateWorkspaces();
          return record;
        }),
      importEntry,
    }).finally(() => {
      setImportingGroupKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    });
  }

  return {
    entries,
    hasMore: data?.cursor != null,
    isLoading,
    loadError: error,
    refresh() {
      void mutate();
    },
    importingIds: currentImportingIds(entries, importingKeys),
    importingId: currentImportingIds(entries, importingKeys).values().next().value ?? null,
    importError,
    importingCwds: currentImportingCwds(kind, entries, importingGroupKeys),
    importEntry,
    importGroup,
  };
}

function importKey(kind: AgentKind, value: string): string {
  return `${kind}\0${value}`;
}

function currentImportingIds(
  entries: readonly AgentHistorySession[],
  importingKeys: ReadonlySet<string>,
): ReadonlySet<AgentHistoryId> {
  const ids = new Set<AgentHistoryId>();
  for (const entry of entries) {
    if (importingKeys.has(importKey(entry.kind, entry.historyId))) ids.add(entry.historyId);
  }
  return ids;
}

function currentImportingCwds(
  kind: AgentKind,
  entries: readonly AgentHistorySession[],
  importingGroupKeys: ReadonlySet<string>,
): ReadonlySet<string> {
  const cwds = new Set<string>();
  for (const entry of entries) {
    if (entry.cwd && importingGroupKeys.has(importKey(kind, entry.cwd))) cwds.add(entry.cwd);
  }
  return cwds;
}
