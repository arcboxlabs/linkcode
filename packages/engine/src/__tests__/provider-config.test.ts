import type { ProvidersConfig, StartOptions } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { applyProviderDefaults } from '../provider-config';

const baseOpts: StartOptions = { kind: 'codex', cwd: '/repo' };

describe('applyProviderDefaults', () => {
  it('returns the input untouched when no config exists for the kind', () => {
    const providers: ProvidersConfig = { 'claude-code': { enabled: true, apiKey: 'sk-x' } };
    expect(applyProviderDefaults(baseOpts, providers)).toBe(baseOpts);
  });

  it('fills the default model only when the client did not specify one', () => {
    const providers: ProvidersConfig = { codex: { enabled: true, defaultModel: 'o4-mini' } };
    expect(applyProviderDefaults(baseOpts, providers).model).toBe('o4-mini');
    expect(applyProviderDefaults({ ...baseOpts, model: 'gpt-4o' }, providers).model).toBe('gpt-4o');
  });

  it('injects the api key into config, preserving existing config keys', () => {
    const providers: ProvidersConfig = { codex: { enabled: true, apiKey: 'sk-live' } };
    const merged = applyProviderDefaults({ ...baseOpts, config: { tools: ['a'] } }, providers);
    expect(merged.config).toEqual({ tools: ['a'], apiKey: 'sk-live' });
  });

  it('does not mutate the input options', () => {
    const providers: ProvidersConfig = {
      codex: { enabled: true, defaultModel: 'o4-mini', apiKey: 'sk' },
    };
    const opts: StartOptions = { kind: 'codex', cwd: '/repo' };
    applyProviderDefaults(opts, providers);
    expect(opts).toEqual({ kind: 'codex', cwd: '/repo' });
  });
});
