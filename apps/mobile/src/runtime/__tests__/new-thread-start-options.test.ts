import { describe, expect, it } from 'vitest';
import { buildStartOptions } from '../new-thread-start-options';

describe('buildStartOptions', () => {
  it('sends only kind and cwd when nothing is picked', () => {
    expect(
      buildStartOptions('claude-code', '/repo', {
        model: null,
        effort: null,
        approvalPolicyId: null,
      }),
    ).toEqual({ kind: 'claude-code', cwd: '/repo' });
  });

  it('sends every explicit pick', () => {
    expect(
      buildStartOptions('codex', '/repo', {
        model: { id: 'gpt-6.1-codex', accountId: 'acct-1' },
        effort: 'xhigh',
        approvalPolicyId: 'full-auto',
      }),
    ).toEqual({
      kind: 'codex',
      cwd: '/repo',
      model: 'gpt-6.1-codex',
      accountId: 'acct-1',
      effort: 'xhigh',
      approvalPolicyId: 'full-auto',
    });
  });

  it('omits accountId when the picked model does not name one', () => {
    expect(
      buildStartOptions('pi', '/repo', {
        model: { id: 'some-model' },
        effort: null,
        approvalPolicyId: null,
      }),
    ).toEqual({ kind: 'pi', cwd: '/repo', model: 'some-model' });
  });
});
