import { describe, expect, it } from 'vitest';
import { customServerDraftSchema } from '../custom-server-dialog';

const schema = customServerDraftSchema((key) => key);

const stdioDraft = { name: 'my-server', transport: 'stdio', command: 'npx' } as const;
const httpDraft = { name: 'my-server', transport: 'http', url: 'https://example.com/mcp' } as const;

function failedPaths(draft: Record<string, unknown>): string[] {
  const result = schema.safeParse(draft);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('customServerDraftSchema', () => {
  it('accepts valid drafts, blank credential lines included', () => {
    expect(failedPaths({ ...stdioDraft, env: 'API_TOKEN=abc\n\nREGION=us\n' })).toEqual([]);
    expect(failedPaths({ ...httpDraft, headers: 'Authorization: Bearer x' })).toEqual([]);
  });

  it('rejects nonblank env lines without a separator or key instead of dropping them', () => {
    expect(failedPaths({ ...stdioDraft, env: 'API_TOKEN' })).toEqual(['env']);
    expect(failedPaths({ ...stdioDraft, env: '=value' })).toEqual(['env']);
  });

  it('rejects malformed header lines', () => {
    expect(failedPaths({ ...httpDraft, headers: 'Authorization Bearer x' })).toEqual(['headers']);
  });

  it('ignores the inactive transport side', () => {
    expect(failedPaths({ ...stdioDraft, headers: 'not a header' })).toEqual([]);
    expect(failedPaths({ ...httpDraft, env: 'not an env line' })).toEqual([]);
  });

  it('keeps the deliberate agent-safe name charset (claude tool ids embed the name)', () => {
    expect(failedPaths({ ...stdioDraft, name: 'my.server' })).toEqual(['name']);
  });
});
