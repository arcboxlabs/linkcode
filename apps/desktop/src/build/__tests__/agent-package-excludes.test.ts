import { describe, expect, it } from 'vitest';
import { agentFilesExcludes } from '../agent-package-excludes';

describe('agentFilesExcludes', () => {
  it('is an exact no-op when unrestricted', () => {
    expect(agentFilesExcludes(null)).toEqual([]);
  });

  it.each([
    ['pi', ['!node_modules/@anthropic-ai/claude-agent-sdk/**', '!node_modules/@openai/codex/**', '!node_modules/@opencode-ai/sdk/**']],
    ['grok-build', ['!node_modules/@anthropic-ai/claude-agent-sdk/**', '!node_modules/@openai/codex/**', '!node_modules/@opencode-ai/sdk/**']],
    ['claude-code', ['!node_modules/@openai/codex/**', '!node_modules/@opencode-ai/sdk/**']],
    ['codex', ['!node_modules/@anthropic-ai/claude-agent-sdk/**', '!node_modules/@opencode-ai/sdk/**']],
    ['opencode', ['!node_modules/@anthropic-ai/claude-agent-sdk/**', '!node_modules/@openai/codex/**']],
  ] as const)('excludes every SDK except the ones the sole allowed kind %s needs', (kind, expected) => {
    expect(agentFilesExcludes([kind])).toEqual(expected);
  });

  it('excludes nothing when every SDK-carrying kind is allowed', () => {
    expect(agentFilesExcludes(['claude-code', 'codex', 'opencode'])).toEqual([]);
  });

  it('never excludes pi or grok-build (neither carries a staged SDK package)', () => {
    const excludes = agentFilesExcludes(['pi']);
    expect(excludes).toHaveLength(3);
    expect(excludes.join(' ')).not.toMatch(/grok|[/@]pi[/@-]/);
  });
});
