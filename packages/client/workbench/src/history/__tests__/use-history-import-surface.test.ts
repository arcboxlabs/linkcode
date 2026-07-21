import type { AgentHistoryId } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { groupFailureAfterRetry } from '../use-history-import-surface';

describe('groupFailureAfterRetry', () => {
  it('removes only the successfully retried row from the directory failures', () => {
    const key = 'claude-code\0/work/linkcode';
    const failures = new Map([
      [key, { total: 3, failedIds: new Set(['two', 'three'] as AgentHistoryId[]) }],
    ]);

    const updated = groupFailureAfterRetry(failures, key, 'two' as AgentHistoryId);
    expect(updated).toEqual(new Map([[key, { total: 3, failedIds: new Set(['three']) }]]));
    expect(groupFailureAfterRetry(updated, key, 'two' as AgentHistoryId)).toBe(updated);
  });

  it('clears the directory result after the final failed row succeeds', () => {
    const key = 'claude-code\0/work/linkcode';
    const failures = new Map([
      [key, { total: 3, failedIds: new Set(['three'] as AgentHistoryId[]) }],
    ]);

    expect(groupFailureAfterRetry(failures, key, 'three' as AgentHistoryId)).toEqual(new Map());
  });

  it('ignores a success for a row that was not a group failure', () => {
    const key = 'claude-code\0/work/linkcode';
    const failures = new Map([
      [key, { total: 2, failedIds: new Set(['two'] as AgentHistoryId[]) }],
    ]);

    expect(groupFailureAfterRetry(failures, key, 'one' as AgentHistoryId)).toBe(failures);
  });
});
