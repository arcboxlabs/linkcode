import type { HistoryGroupImportResult } from './use-provider-history';

export type HistoryImportOnboardingAction = 'wait' | 'offer' | 'complete' | 'none';

export function historyImportOnboardingAction({
  handled,
  scansComplete,
  importableCount,
}: {
  handled: boolean;
  scansComplete: boolean;
  importableCount: number;
}): HistoryImportOnboardingAction {
  if (handled) return 'none';
  if (!scansComplete) return 'wait';
  return importableCount > 0 ? 'offer' : 'complete';
}

export interface BulkHistoryImportResult {
  importedCount: number;
  failedCount: number;
}

export function summarizeHistoryGroupImports(
  results: readonly HistoryGroupImportResult[],
): BulkHistoryImportResult {
  return results.reduce(
    (summary, result) => ({
      importedCount: summary.importedCount + result.imported.length,
      failedCount: summary.failedCount + result.failures.length,
    }),
    { importedCount: 0, failedCount: 0 },
  );
}
