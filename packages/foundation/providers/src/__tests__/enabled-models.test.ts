import type { Account, Accounts } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { accountEnabledFor, enabledAccountModels } from '../enabled-models';

function account(id: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    label: id,
    service: 'deepseek',
    credential: { type: 'api-key', key: 'sk-test' },
    createdAt: 0,
    ...overrides,
  };
}

const POOL: Accounts = [
  account('acc_a', { models: [{ id: 'a-1' }, { id: 'a-2', label: 'A Two' }] }),
  account('acc_b', { models: [{ id: 'b-1' }] }),
];

describe('enabledAccountModels', () => {
  it('follows pool order then model order, so the head is a stable default', () => {
    expect(
      enabledAccountModels(POOL, {}, 'opencode').map(({ account: a, model }) => [a.id, model.id]),
    ).toEqual([
      ['acc_a', 'a-1'],
      ['acc_a', 'a-2'],
      ['acc_b', 'b-1'],
    ]);
    // Reversing the pool moves the head: the order is the pool's, not a sort of its own.
    expect(enabledAccountModels([...POOL].reverse(), {}, 'opencode')[0]?.model.id).toBe('b-1');
  });

  it('narrows to the enabled list, and offers every bindable account when it is absent', () => {
    const narrowed = enabledAccountModels(
      POOL,
      { opencode: { enabled: true, enabledAccountIds: ['acc_b'] } },
      'opencode',
    );
    expect(narrowed.map(({ model }) => model.id)).toEqual(['b-1']);
    expect(enabledAccountModels(POOL, undefined, 'opencode')).toHaveLength(3);
    expect(
      enabledAccountModels(
        POOL,
        { opencode: { enabled: true, enabledAccountIds: [] } },
        'opencode',
      ),
    ).toEqual([]);
  });

  it('drops an account that cannot back the agent even when it is enabled', () => {
    // Cloudflare's Anthropic leg serves that protocol alone, and codex speaks only responses.
    const anthropicOnly = account('acc_cf', {
      service: 'cloudflare-anthropic',
      endpointParams: { account_id: '8f3a', gateway_id: 'prod' },
      models: [{ id: 'claude-opus-5' }],
    });
    expect(enabledAccountModels([anthropicOnly], {}, 'codex')).toEqual([]);
    expect(enabledAccountModels([anthropicOnly], {}, 'claude-code')).toHaveLength(1);
    const sub = account('acc_sub', {
      service: 'claude-sub',
      credential: { type: 'oauth', agent: 'claude-code' },
      models: [{ id: 'claude-opus-5' }],
    });
    expect(enabledAccountModels([sub], {}, 'codex')).toEqual([]);
    expect(enabledAccountModels([sub], {}, 'claude-code')).toHaveLength(1);
  });

  it("narrows a picked model to the protocols it is known to answer, for the agent's actual binding", () => {
    const gateway = account('acc_gw', {
      service: 'linkcode-gateway',
      credential: { type: 'auth-token', token: 'lc-test' },
      models: [
        { id: 'openai/gpt-5.6', protocols: ['openai-chat', 'openai-responses'] },
        { id: 'anthropic/claude-sonnet-5', protocols: ['openai-chat', 'anthropic'] },
        // Probed before `protocols` existed, or never probed — absence must still offer it.
        { id: 'openai/gpt-4.1' },
      ],
    });
    // codex binds this account on openai-responses: only the model tagged for it survives, plus
    // the one with no protocol data at all.
    expect(enabledAccountModels([gateway], {}, 'codex').map(({ model }) => model.id)).toEqual([
      'openai/gpt-5.6',
      'openai/gpt-4.1',
    ]);
    // claude-code and opencode both fall through to the account's own native anthropic wire (no
    // knownProvider pins opencode elsewhere), so only the model actually tagged for it, plus the
    // untagged one, survive.
    expect(enabledAccountModels([gateway], {}, 'claude-code').map(({ model }) => model.id)).toEqual(
      ['anthropic/claude-sonnet-5', 'openai/gpt-4.1'],
    );
    expect(enabledAccountModels([gateway], {}, 'opencode').map(({ model }) => model.id)).toEqual([
      'anthropic/claude-sonnet-5',
      'openai/gpt-4.1',
    ]);
  });

  it('reports an account with no picked model as offering nothing, not as unavailable', () => {
    expect(enabledAccountModels([account('acc_empty')], {}, 'opencode')).toEqual([]);
    expect(accountEnabledFor({}, 'opencode', 'acc_empty')).toBe(true);
    expect(
      accountEnabledFor(
        { opencode: { enabled: true, enabledAccountIds: [] } },
        'opencode',
        'acc_a',
      ),
    ).toBe(false);
  });
});
