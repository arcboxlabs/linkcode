import { describe, expect, it } from 'vitest';
import { claudeCodeEnv, codexEnv, readAgentCredential } from '../credential';

describe('readAgentCredential', () => {
  it('returns empty for missing config', () => {
    expect(readAgentCredential(undefined)).toEqual({});
  });

  it('reads the credential/endpoint fields', () => {
    expect(
      readAgentCredential({
        apiKey: 'sk-1',
        authToken: 'tok',
        baseUrl: 'https://gw/api',
        extraEnv: { A: '1', B: 2, C: 'z' },
      }),
    ).toEqual({
      apiKey: 'sk-1',
      authToken: 'tok',
      baseUrl: 'https://gw/api',
      extraEnv: { A: '1', C: 'z' }, // non-string values dropped
    });
  });

  it('ignores non-string / empty values and unrelated keys', () => {
    expect(readAgentCredential({ apiKey: '', accountId: 'acc_1', baseUrl: 123 })).toEqual({});
  });
});

describe('claudeCodeEnv', () => {
  const base = { PATH: '/usr/bin', HOME: '/home/x' };

  it('returns undefined when the account contributes nothing', () => {
    expect(claudeCodeEnv(base, {})).toBeUndefined();
  });

  it('sets ANTHROPIC_API_KEY for an api key and preserves the base env', () => {
    expect(claudeCodeEnv(base, { apiKey: 'sk-1' })).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/x',
      ANTHROPIC_API_KEY: 'sk-1',
    });
  });

  it('routes an auth token to ANTHROPIC_AUTH_TOKEN and blanks ANTHROPIC_API_KEY', () => {
    // The gateway gotcha: a non-empty ANTHROPIC_API_KEY (even inherited) outranks the token.
    const env = claudeCodeEnv({ ...base, ANTHROPIC_API_KEY: 'inherited' }, { authToken: 'gw-tok' });
    expect(env?.ANTHROPIC_AUTH_TOKEN).toBe('gw-tok');
    expect(env?.ANTHROPIC_API_KEY).toBe('');
  });

  it('prefers the auth token over an api key when both are present', () => {
    const env = claudeCodeEnv(base, { apiKey: 'sk-1', authToken: 'gw-tok' });
    expect(env?.ANTHROPIC_AUTH_TOKEN).toBe('gw-tok');
    expect(env?.ANTHROPIC_API_KEY).toBe('');
  });

  it('attaches a base URL alone (gateway with the CLI login) without a credential', () => {
    const env = claudeCodeEnv(base, { baseUrl: 'https://gw/api' });
    expect(env?.ANTHROPIC_BASE_URL).toBe('https://gw/api');
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
  });

  it('merges extraEnv', () => {
    const env = claudeCodeEnv(base, {
      apiKey: 'sk-1',
      extraEnv: { CLAUDE_CODE_ENABLE_AUTO_MODE: '1' },
    });
    expect(env?.CLAUDE_CODE_ENABLE_AUTO_MODE).toBe('1');
  });
});

describe('codexEnv', () => {
  it('returns undefined when nothing is contributed', () => {
    expect(codexEnv({})).toBeUndefined();
  });

  it('maps a key or token to CODEX_API_KEY and a base URL to OPENAI_BASE_URL', () => {
    expect(codexEnv({ apiKey: 'sk-1', baseUrl: 'https://gw/v1' })).toEqual({
      CODEX_API_KEY: 'sk-1',
      OPENAI_BASE_URL: 'https://gw/v1',
    });
    expect(codexEnv({ authToken: 'tok' })).toEqual({ CODEX_API_KEY: 'tok' });
  });
});
