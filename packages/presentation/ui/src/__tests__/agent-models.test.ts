import { describe, expect, it } from 'vitest';
import { AGENT_MODEL_OPTIONS, groupModelsByProvider, resolveModel } from '../shell/agent-models';

const claude = AGENT_MODEL_OPTIONS['claude-code'];
const codex = AGENT_MODEL_OPTIONS.codex;

describe('resolveModel', () => {
  it('resolves an exact catalog id', () => {
    expect(resolveModel(claude, 'claude-opus-4-8')?.label).toBe('Opus 4.8');
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
