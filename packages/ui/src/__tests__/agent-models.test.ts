import { describe, expect, it } from 'vitest';
import { AGENT_MODEL_OPTIONS, resolveModel } from '../shell/agent-models';

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
