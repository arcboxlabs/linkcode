import { describe, expect, it } from 'vitest';
import { effortOptionsForModel } from '../shell/agent-efforts';
import type { ModelOption } from '../shell/agent-models';
import { groupModelsByProvider, resolveModel, switchesAccount } from '../shell/agent-models';

// Ids and aliases straight from `CURATED_AGENT_MODELS`; the prefix rules under test are about the
// shape of the ids a provider serves, not about where the list came from.
const claude: ModelOption[] = [
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];
// Codex advertises per-model effort levels on its live catalog; these mirror `model/list`.
const codex: ModelOption[] = [
  {
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6-Sol',
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
  },
  { id: 'gpt-5.4', label: 'GPT-5.4' },
  {
    id: 'gpt-5.6-luna',
    label: 'GPT-5.6-Luna',
    effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
];

describe('resolveModel', () => {
  it('resolves an exact catalog id', () => {
    expect(resolveModel(claude, 'claude-opus-5')?.label).toBe('Opus 5');
  });

  it('resolves a served snapshot id back to its alias by prefix', () => {
    // claude-haiku-4-5 is served as the pinned snapshot claude-haiku-4-5-20251001.
    expect(resolveModel(claude, 'claude-haiku-4-5-20251001')?.id).toBe('claude-haiku-4-5');
  });

  it('prefers an exact match over a prefix so gpt-5.4-mini is not read as gpt-5.4', () => {
    expect(resolveModel(codex, 'gpt-5.4-mini')?.id).toBe('gpt-5.4-mini');
  });

  it('returns undefined for null, unknown, or absent options', () => {
    expect(resolveModel(claude, null)).toBeUndefined();
    expect(resolveModel(claude, 'not-a-model')).toBeUndefined();
    expect(resolveModel(undefined, 'claude-opus-4-8')).toBeUndefined();
  });
});

describe('switchesAccount', () => {
  const onSecond = { id: 'model-a', label: 'A', accountId: 'acc_second' };

  it('flags an entry from an account the session is not running on', () => {
    expect(switchesAccount(onSecond, 'acc_first')).toBe(true);
    expect(switchesAccount(onSecond, 'acc_second')).toBe(false);
  });

  it('stays false when either side has no account to compare', () => {
    // A draft has no running account, and a curated-table entry belongs to none.
    expect(switchesAccount(onSecond, undefined)).toBe(false);
    expect(switchesAccount({ id: 'model-a', label: 'A' }, 'acc_first')).toBe(false);
  });
});

describe('groupModelsByProvider', () => {
  const multiProvider = [
    { id: 'opencode/hy3', label: 'Hy3', description: 'OpenCode Zen' },
    { id: 'openai/gpt-5.4', label: 'GPT-5.4', description: 'OpenAI' },
    { id: 'opencode/big-pickle', label: 'Big Pickle', description: 'OpenCode Zen' },
    { id: 'openai/gpt-5.6-sol', label: 'GPT-5.6 Sol', description: 'OpenAI' },
  ];

  it('groups by provider in first-appearance order, preserving catalog order within groups', () => {
    expect(groupModelsByProvider(multiProvider)).toStrictEqual({
      ungrouped: [],
      groups: [
        { label: 'OpenCode Zen', options: [multiProvider[0], multiProvider[2]] },
        { label: 'OpenAI', options: [multiProvider[1], multiProvider[3]] },
      ],
    });
  });

  it('collects descriptionless options into ungrouped', () => {
    const legacy = { id: 'legacy', label: 'Legacy' };
    expect(groupModelsByProvider([legacy, ...multiProvider])?.ungrouped).toStrictEqual([legacy]);
  });

  it('returns null below two distinct providers so the flat list renders', () => {
    expect(groupModelsByProvider(undefined)).toBeNull();
    expect(groupModelsByProvider([])).toBeNull();
    // Static tables carry no provider subtitle.
    expect(groupModelsByProvider(claude)).toBeNull();
    // Single-provider catalogs (e.g. opencode pinned to one credential) stay flat too.
    expect(
      groupModelsByProvider(multiProvider.filter((option) => option.description === 'OpenAI')),
    ).toBeNull();
  });
});

describe('effortOptionsForModel', () => {
  it('uses per-model Codex capabilities instead of the conservative agent fallback', () => {
    expect(effortOptionsForModel('codex', codex?.[0])?.map((option) => option.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra',
    ]);
    expect(effortOptionsForModel('codex', codex?.[2])?.map((option) => option.id)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
  });

  it('limits Pi effort choices to the selected dynamic model', () => {
    expect(
      effortOptionsForModel('pi', {
        id: 'banned/basic',
        label: 'Basic',
        effortLevels: [],
      }),
    ).toEqual([]);
    expect(
      effortOptionsForModel('pi', {
        id: 'banned/reasoning',
        label: 'Reasoning',
        effortLevels: ['low', 'high'],
      }),
    ).toEqual([
      { id: 'low', label: 'Low', shortLabel: 'L' },
      { id: 'high', label: 'High', shortLabel: 'H' },
    ]);
  });

  it('keeps agent-level choices when a model has no capability metadata', () => {
    expect(effortOptionsForModel('codex', { id: 'gpt-5.5', label: 'GPT-5.5' })).toHaveLength(4);
  });
});
