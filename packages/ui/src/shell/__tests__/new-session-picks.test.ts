import type { AgentStartCatalog } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { deriveNewSessionPicks } from '../new-session-surface';

const PI_CATALOG: AgentStartCatalog = {
  models: [
    { id: 'openai/gpt-x', label: 'GPT X', effortLevels: ['low', 'medium', 'high'] },
    { id: 'anthropic/claude-y', label: 'Claude Y', effortLevels: [] },
  ],
  policies: [
    { policyId: 'default', name: 'Ask' },
    { policyId: 'acceptEdits', name: 'Accept edits' },
    { policyId: 'bypassPermissions', name: 'Bypass' },
  ],
  defaultPolicyId: 'default',
};

function picks(overrides: Partial<Parameters<typeof deriveNewSessionPicks>[0]>) {
  return {
    provider: 'pi' as const,
    model: null,
    effort: null,
    policyId: null,
    modeId: 'default',
    ...overrides,
  };
}

describe('deriveNewSessionPicks', () => {
  it('rides a model from the dynamic catalog and drops one the provider does not offer', () => {
    expect(deriveNewSessionPicks(picks({ model: 'openai/gpt-x' }), PI_CATALOG).model).toBe(
      'openai/gpt-x',
    );
    expect(
      deriveNewSessionPicks(picks({ model: 'openai/other' }), PI_CATALOG).model,
    ).toBeUndefined();
  });

  it('falls back to the static table when the kind has no catalog', () => {
    // claude-code has a static AGENT_MODEL_OPTIONS entry; a pick from it rides without a catalog.
    const claude = picks({ provider: 'claude-code', model: 'openai/gpt-x' });
    expect(deriveNewSessionPicks(claude, undefined).model).toBeUndefined();
  });

  it('rides only a divergent approval tier, never the default', () => {
    expect(
      deriveNewSessionPicks(picks({ policyId: 'default' }), PI_CATALOG).approvalPolicyId,
    ).toBeUndefined();
    expect(
      deriveNewSessionPicks(picks({ policyId: 'bypassPermissions' }), PI_CATALOG).approvalPolicyId,
    ).toBe('bypassPermissions');
    // A tier the catalog does not list never rides (a stale pick after a provider switch).
    expect(
      deriveNewSessionPicks(picks({ policyId: 'plan' }), PI_CATALOG).approvalPolicyId,
    ).toBeUndefined();
  });

  it('passes effort through and strips the default workflow mode', () => {
    const derived = deriveNewSessionPicks(picks({ effort: 'high', modeId: 'default' }), PI_CATALOG);
    expect(derived.effort).toBe('high');
    expect(derived.modeId).toBeUndefined();
    expect(deriveNewSessionPicks(picks({ modeId: 'plan' }), PI_CATALOG).modeId).toBe('plan');
  });
});
