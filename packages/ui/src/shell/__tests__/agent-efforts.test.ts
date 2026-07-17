import { describe, expect, it } from 'vitest';
import { effortOptionsForModel } from '../agent-efforts';

describe('effortOptionsForModel', () => {
  it('uses a dynamic model capability to hide unsupported effort levels', () => {
    expect(
      effortOptionsForModel('pi', {
        id: 'openai/basic',
        label: 'Basic',
        effortLevels: [],
      }),
    ).toEqual([]);
    expect(
      effortOptionsForModel('pi', {
        id: 'openai/reasoning',
        label: 'Reasoning',
        effortLevels: ['low', 'high'],
      }),
    ).toEqual([
      { id: 'low', label: 'Low' },
      { id: 'high', label: 'High' },
    ]);
  });

  it('keeps the agent-level defaults when a catalog has no capability data', () => {
    expect(effortOptionsForModel('codex', { id: 'gpt-5.5', label: 'GPT-5.5' })).toHaveLength(4);
  });
});
