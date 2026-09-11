// @vitest-environment jsdom

import type { AgentKind } from '@linkcode/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ProviderAccountDetailViewModel,
  ProviderAgentViewModel,
} from '../providers/account-detail';
import { AccountDetail } from '../providers/account-detail';

/** Names each value, so an assertion says which number it expected where. */
function passthrough(key: string, values?: Record<string, unknown>): string {
  if (!values) return key;
  const named = Object.entries(values).map(([name, value]) => `${name}=${String(value)}`);
  return `${key}:${named.join(',')}`;
}

vi.mock('use-intl', () => ({ useTranslations: () => passthrough }));

afterEach(cleanup);

const REACHABLE_PATTERN = /modelsReachable/;

function detail(agents: ProviderAgentViewModel[]): ProviderAccountDetailViewModel {
  const bound = agents.reduce<AgentKind[]>((kinds, agent) => {
    if (agent.enabled) kinds.push(agent.kind);
    return kinds;
  }, []);
  return {
    id: 'acc_gw',
    label: 'LinkCode Gateway',
    credential: { kind: 'secret', type: 'auth-token', value: 'lc-secret', maskedValue: 'lc-…ret' },
    agents,
    boundAgents: bound,
    enabledAgentCount: bound.length,
    availableAgentCount: agents.filter(({ tier }) => tier !== 'unavailable').length,
  };
}

function renderDetail(agent: ProviderAgentViewModel): void {
  render(
    <AccountDetail
      account={detail([agent])}
      busy={false}
      onSetAccountEnabled={vi.fn()}
      onEdit={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
}

describe('AccountDetail agent rows', () => {
  it('names the share it was handed, each number under its own placeholder', () => {
    renderDetail({
      kind: 'codex',
      tier: 'native',
      enabled: true,
      status: { kind: 'model-shortfall', picked: 3, reachable: 2 },
    });
    expect(screen.getByText('modelsReachable:picked=3,reachable=2')).toBeTruthy();
  });

  // Which one of these a row gets is the view model's call (see the workbench view tests); the
  // row's own rule is only that an absent status says nothing at all.
  it('says nothing when it was handed no status', () => {
    renderDetail({ kind: 'codex', tier: 'native', enabled: true });
    expect(screen.queryByText(REACHABLE_PATTERN)).toBeNull();
  });

  it('says why an enabled agent offers nothing instead of leaving the switch to imply it', () => {
    renderDetail({
      kind: 'codex',
      tier: 'native',
      enabled: true,
      status: { kind: 'no-reachable-model' },
    });
    expect(screen.getByText('noReachableModel')).toBeTruthy();
    // Zero reachable is the status' story; a "0 of 3" ratio beside it would say it twice.
    expect(screen.queryByText(REACHABLE_PATTERN)).toBeNull();
  });
});
