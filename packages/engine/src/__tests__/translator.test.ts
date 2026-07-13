import type { StartOptions } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import {
  TRANSLATOR_PLACEHOLDER_TOKEN,
  translationUpstream,
  withTranslatorEndpoint,
} from '../translator';

const gatewayOpts: StartOptions = {
  kind: 'claude-code',
  cwd: '/repo',
  model: 'claude-x',
  config: { baseUrl: 'https://api.openai.com/v1', protocol: 'openai-chat', apiKey: 'sk-up' },
};

describe('translationUpstream', () => {
  it('routes a claude-code openai-chat account to the sidecar', () => {
    expect(translationUpstream(gatewayOpts)).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-up',
      wire: 'openai-chat',
      model: 'claude-x',
    });
  });

  it('falls back to the auth token as the upstream key', () => {
    const opts: StartOptions = {
      ...gatewayOpts,
      config: { baseUrl: 'https://gw/v1', protocol: 'openai-chat', authToken: 'tok' },
    };
    expect(translationUpstream(opts)?.apiKey).toBe('tok');
  });

  it('does not translate a non-claude agent', () => {
    expect(translationUpstream({ ...gatewayOpts, kind: 'codex' })).toBeUndefined();
  });

  it('does not translate a native anthropic account', () => {
    const opts: StartOptions = {
      ...gatewayOpts,
      config: { baseUrl: 'https://gw', protocol: 'anthropic', apiKey: 'sk' },
    };
    expect(translationUpstream(opts)).toBeUndefined();
  });

  it('needs both a base URL and a key', () => {
    expect(
      translationUpstream({ ...gatewayOpts, config: { protocol: 'openai-chat', apiKey: 'sk' } }),
    ).toBeUndefined();
    expect(
      translationUpstream({
        ...gatewayOpts,
        config: { protocol: 'openai-chat', baseUrl: 'https://gw' },
      }),
    ).toBeUndefined();
  });
});

describe('withTranslatorEndpoint', () => {
  it('rewrites the endpoint to the local translator and drops the real key', () => {
    const rewritten = withTranslatorEndpoint(
      { ...gatewayOpts, config: { ...gatewayOpts.config, extraEnv: { A: '1' } } },
      'http://127.0.0.1:5123',
    );
    expect(rewritten.config).toEqual({
      baseUrl: 'http://127.0.0.1:5123',
      protocol: 'anthropic',
      authToken: TRANSLATOR_PLACEHOLDER_TOKEN,
      apiKey: undefined,
      extraEnv: { A: '1' },
    });
  });
});
