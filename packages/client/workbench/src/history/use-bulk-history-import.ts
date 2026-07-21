import type { AgentHistorySession, AgentKind } from '@linkcode/schema';
import { listSessions } from '@linkcode/sdk';
import { noop } from 'foxact/noop';
import { useState } from 'react';
import { useData } from '../runtime/tayori';
import type { BulkHistoryImportResult } from './bulk-import';
import { summarizeHistoryGroupImports } from './bulk-import';
import { importedSessionByHistoryId, importedSessionKey } from './imported';
import type { ProviderHistory } from './use-provider-history';
import { useProviderHistory } from './use-provider-history';

export interface BulkHistoryImportSurface {
  importableCount: number;
  isScanning: boolean;
  scanFailedCount: number;
  isImporting: boolean;
  result: BulkHistoryImportResult | null;
  scanComplete: boolean;
  importAll: () => Promise<void>;
  resetResult: () => void;
}

export function useBulkHistoryImport(): BulkHistoryImportSurface {
  const claude = useProviderHistory('claude-code');
  const codex = useProviderHistory('codex');
  const opencode = useProviderHistory('opencode');
  const pi = useProviderHistory('pi');
  const grokBuild = useProviderHistory('grok-build');
  const historyByKind: Record<AgentKind, ProviderHistory> = {
    'claude-code': claude,
    codex,
    opencode,
    pi,
    'grok-build': grokBuild,
  };
  const histories = Object.values(historyByKind);
  const {
    data: sessions,
    isLoading: sessionsLoading,
    error: sessionsError,
    mutate: refreshSessions,
  } = useData(listSessions, {});
  const imported = importedSessionByHistoryId(sessions ?? []);
  const [importedInBatch, setImportedInBatch] = useState<ReadonlySet<string>>(() => new Set());
  const importable = histories.flatMap((history) =>
    history.entries.filter((entry) => {
      const key = importedSessionKey(entry.kind, entry.historyId);
      const groupImporting = entry.cwd !== undefined && history.importingCwds.has(entry.cwd);
      return (
        !imported.has(key) &&
        !importedInBatch.has(key) &&
        !history.importingIds.has(entry.historyId) &&
        !groupImporting
      );
    }),
  );
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<BulkHistoryImportResult | null>(null);

  async function importAll(): Promise<void> {
    if (isImporting) return;
    const entries = importable;
    setIsImporting(true);
    setResult(null);
    try {
      const groups = groupByProviderDirectory(entries);
      const importedKeys = new Set<string>();
      const completed = await Promise.all(
        groups.map(async (group) => {
          const result = await historyByKind[group.kind].importGroup(group.cwd, group.entries);
          if (!result) return null;
          const importedIds = new Set(result.imported);
          for (const entry of group.entries) {
            if (importedIds.has(entry.historyId)) {
              importedKeys.add(importedSessionKey(entry.kind, entry.historyId));
            }
          }
          return result;
        }),
      );
      setImportedInBatch((current) => {
        const next = new Set(current);
        for (const key of importedKeys) next.add(key);
        return next;
      });
      await refreshSessions().catch(noop);
      setResult(summarizeHistoryGroupImports(completed.filter((result) => result !== null)));
    } finally {
      setIsImporting(false);
    }
  }

  return {
    importableCount: importable.length,
    isScanning: sessionsLoading || histories.some((history) => history.isLoading),
    scanFailedCount: histories.filter((history) => history.loadError != null).length,
    scanComplete:
      sessions !== undefined &&
      sessionsError == null &&
      !sessionsLoading &&
      !histories.some((history) => history.isLoading) &&
      (importable.length > 0 || histories.every((history) => history.loadError == null)),
    isImporting,
    result,
    importAll,
    resetResult() {
      setResult(null);
    },
  };
}

function groupByProviderDirectory(entries: readonly AgentHistorySession[]) {
  const groups = new Map<string, AgentHistorySession[]>();
  for (const entry of entries) {
    const key = `${entry.kind}\0${entry.cwd ?? ''}`;
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.values()].map((group) => ({
    kind: group[0].kind,
    cwd: group[0].cwd ?? '',
    entries: group,
  }));
}
