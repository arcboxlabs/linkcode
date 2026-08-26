// @vitest-environment jsdom

import type { Accounts, ProvidersConfig } from '@linkcode/schema';
import { getProviderConfig } from '@linkcode/sdk';
import { modelChoiceKey } from '@linkcode/ui';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountModelOptions,
  selectableHarnessKinds,
  useAccountModelOptions,
} from '../model-options';

const { useDataMock } = vi.hoisted(() => ({ useDataMock: vi.fn() }));

vi.mock('../../../runtime/tayori', () => ({ useData: useDataMock }));

let providersData: ProvidersConfig | undefined;
let accountsData: Accounts | undefined;

beforeEach(() => {
  providersData = undefined;
  accountsData = undefined;
  useDataMock.mockImplementation((operation: unknown) => ({
    data: operation === getProviderConfig ? providersData : accountsData,
  }));
});

afterEach(() => {
  cleanup();
  useDataMock.mockReset();
});

const anthropicAccount = {
  id: 'acc_anthropic',
  label: 'Anthropic',
  service: 'anthropic-api',
  credential: { type: 'api-key', key: 'k' },
  models: [{ id: 'claude-opus-5', label: 'Opus 5' }],
  createdAt: 0,
} satisfies Accounts[number];

const deepseekAccount = {
  id: 'acc_deepseek',
  label: 'DeepSeek',
  service: 'deepseek',
  credential: { type: 'api-key', key: 'k' },
  models: [{ id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' }, { id: 'deepseek-v4-flash' }],
  createdAt: 0,
} satisfies Accounts[number];

describe('accountModelOptions', () => {
  it('spans every account that can back the agent, tagged with the account it came from', () => {
    const options = accountModelOptions([anthropicAccount, deepseekAccount]);

    // claude-code speaks both: Anthropic natively, DeepSeek through its Anthropic-shaped endpoint.
    expect(options['claude-code']).toEqual([
      {
        id: 'claude-opus-5',
        label: 'Opus 5',
        description: 'Anthropic',
        accountId: 'acc_anthropic',
      },
      {
        id: 'deepseek-v4-pro',
        label: 'DeepSeek V4 Pro',
        description: 'DeepSeek',
        accountId: 'acc_deepseek',
      },
      {
        id: 'deepseek-v4-flash',
        // A relay ships bare ids; the id doubles as the label rather than rendering blank.
        label: 'deepseek-v4-flash',
        description: 'DeepSeek',
        accountId: 'acc_deepseek',
      },
    ]);
  });

  it('omits an agent no account can back, and keeps a bindable-but-unpicked one empty', () => {
    // grok-build only accepts an xAI account, so neither of these can back it.
    expect(accountModelOptions([anthropicAccount, deepseekAccount])['grok-build']).toBeUndefined();
    // Bindable with nothing ticked: present-and-empty, which is what blocks sending.
    expect(
      accountModelOptions([{ ...anthropicAccount, models: undefined }])['claude-code'],
    ).toEqual([]);
  });

  it('offers only the accounts enabled for that agent, and every bindable one when unset', () => {
    const pool = [anthropicAccount, deepseekAccount];
    // Both can back claude-code, and an absent list means the user has narrowed nothing.
    expect(accountModelOptions(pool, {})['claude-code']).toHaveLength(
      accountModelOptions(pool)['claude-code']?.length ?? 0,
    );

    const narrowed = accountModelOptions(pool, {
      'claude-code': { enabled: true, enabledAccountIds: ['acc_deepseek'] },
    })['claude-code'];
    expect(new Set(narrowed?.map((option) => option.accountId))).toEqual(new Set(['acc_deepseek']));

    // Disabling every account leaves it present-and-empty, which blocks sending rather than
    // silently handing the choice back to the agent.
    expect(
      accountModelOptions(pool, { 'claude-code': { enabled: true, enabledAccountIds: [] } })[
        'claude-code'
      ],
    ).toEqual([]);
  });

  it('keeps same-id models from two accounts as separate, identifiable entries', () => {
    const shared = { ...anthropicAccount, id: 'acc_other', label: 'Work key' };
    const options = accountModelOptions([anthropicAccount, shared])['claude-code'] ?? [];

    expect(options).toHaveLength(2);
    expect(new Set(options.map(modelChoiceKey)).size).toBe(2);
  });

  it('stays unresolved until both the account pool and the enabled lists have loaded', () => {
    const { result, rerender } = renderHook(() => useAccountModelOptions());

    expect(result.current).toBeNull();

    // Accounts alone are not enough: the enabled list narrows them, so offering the unnarrowed set
    // would briefly show models the user disabled.
    accountsData = [];
    rerender();
    expect(result.current).toBeNull();

    providersData = {};
    rerender();
    expect(result.current).toEqual({});
  });
});

describe('selectableHarnessKinds', () => {
  it('includes unconfigured harnesses by default and removes disabled ones', () => {
    expect(selectableHarnessKinds({ opencode: { enabled: false } })).toEqual([
      'claude-code',
      'codex',
      'pi',
      'grok-build',
    ]);
  });

  it('is unaffected by allowedAgents when null or absent (standard build, CODE-618)', () => {
    const withoutRestriction = selectableHarnessKinds({ opencode: { enabled: false } });
    expect(selectableHarnessKinds({ opencode: { enabled: false } }, null)).toEqual(
      withoutRestriction,
    );
    expect(selectableHarnessKinds({ opencode: { enabled: false } })).toEqual(withoutRestriction);
  });

  it('intersects the enabled set with a restricted-brand allowlist', () => {
    expect(selectableHarnessKinds({}, ['pi'])).toEqual(['pi']);
    expect(selectableHarnessKinds({ pi: { enabled: false } }, ['pi'])).toEqual([]);
    expect(selectableHarnessKinds({}, ['pi', 'codex'])).toEqual(['codex', 'pi']);
  });
});
