import { AgentHistoryIdSchema } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { historyImportOnboardingAction, summarizeHistoryGroupImports } from '../bulk-import';

const HISTORY_1 = AgentHistoryIdSchema.parse('history-1');

it.each([
  ['offers on the first completed scan', false, 3, 'offer'],
  ['stays closed when already handled', true, 3, 'none'],
  ['completes without prompting when no history is found', false, 0, 'complete'],
  ['does not trigger again after the first offer is handled', true, 1, 'none'],
] as const)('%s', (_name, handled, importableCount, expected) => {
  expect(historyImportOnboardingAction({ handled, scansComplete: true, importableCount })).toBe(
    expected,
  );
});

it('combines successful and partial directory imports', () => {
  expect(
    summarizeHistoryGroupImports([
      { imported: [HISTORY_1], failures: [] },
      {
        imported: [AgentHistoryIdSchema.parse('history-2')],
        failures: [
          { historyId: AgentHistoryIdSchema.parse('history-3'), error: new Error('failed') },
        ],
      },
    ]),
  ).toEqual({
    importedCount: 2,
    failedCount: 1,
  });
});
