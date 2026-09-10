// @vitest-environment jsdom

import type { AgentKind } from '@linkcode/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ProviderAccountDetailViewModel,
  ProviderAgentViewModel,
} from '../providers/account-detail';
import { AccountDetail } from '../providers/account-detail';

function passthrough(key: string, values?: Record<string, unknown>): string {
  const interpolation = values ? Object.values(values).join(',') : '';
  return interpolation ? `${key}:${interpolation}` : key;
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
  it('names the reachable share only when the agent cannot run the whole picked set', () => {
    renderDetail({
      kind: 'codex',
      tier: 'native',
      enabled: true,
      models: { picked: 3, reachable: 2 },
    });
    expect(screen.getByText('modelsReachable:2,3')).toBeTruthy();
  });

  it('stays silent when every picked model runs on this agent', () => {
    renderDetail({
      kind: 'codex',
      tier: 'native',
      enabled: true,
      models: { picked: 3, reachable: 3 },
    });
    expect(screen.queryByText(REACHABLE_PATTERN)).toBeNull();
  });

  it('says why an enabled agent offers nothing instead of leaving the switch to imply it', () => {
    renderDetail({
      kind: 'codex',
      tier: 'native',
      enabled: true,
      models: { picked: 3, reachable: 0 },
      status: { kind: 'no-reachable-model' },
    });
    expect(screen.getByText('noReachableModel')).toBeTruthy();
    // Zero reachable is the status' story; a "0 of 3" count next to it would say it twice.
    expect(screen.queryByText(REACHABLE_PATTERN)).toBeNull();
  });
});
