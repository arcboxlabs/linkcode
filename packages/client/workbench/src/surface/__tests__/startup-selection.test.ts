import type { AgentEvent } from '@linkcode/schema';
import { describe, expect, it } from 'vitest';
import { newlyConfirmedStartupSelection, reflectedStartupSelection } from '../startup-selection';

function events(...items: AgentEvent[]) {
  return items.map((event, index) => ({ event, seq: index + 1 }));
}

describe('reflectedStartupSelection', () => {
  it('retains only model and effort values the provider ultimately reflected', () => {
    expect(
      reflectedStartupSelection(
        { model: 'requested-model', effort: 'high' },
        events(
          { type: 'model-update', model: 'requested-model' },
          { type: 'effort-update', effort: 'high' },
        ),
      ),
    ).toEqual({ model: 'requested-model', effort: 'high' });
  });

  it('clears a rejected effort instead of persisting the submitted value', () => {
    expect(
      reflectedStartupSelection(
        { model: 'requested-model', effort: 'ultracode' },
        events(
          { type: 'model-update', model: 'requested-model' },
          {
            type: 'error',
            code: 'AGENT_ERROR',
            message: 'dynamic workflows disabled',
            recoverable: true,
          },
        ),
      ),
    ).toEqual({ model: 'requested-model', effort: null });
  });

  it('uses the last reflection when startup reports an initial value then corrects it', () => {
    expect(
      reflectedStartupSelection(
        { model: 'unavailable-model', effort: 'high' },
        events(
          { type: 'model-update', model: 'unavailable-model' },
          { type: 'effort-update', effort: 'high' },
          { type: 'model-update', model: 'provider-default' },
        ),
      ),
    ).toEqual({ model: null, effort: 'high' });
  });

  it('preserves explicit resets without requiring a provider reflection', () => {
    expect(reflectedStartupSelection({ model: null, effort: null }, events())).toEqual({
      model: null,
      effort: null,
    });
  });

  it('promotes a late exact confirmation without replaying a stale mismatch', () => {
    const requested = { model: 'grok-turn', effort: 'xhigh' } as const;
    const initial = { model: null, effort: null } as const;

    expect(
      newlyConfirmedStartupSelection(
        requested,
        initial,
        events(
          { type: 'model-update', model: 'grok-turn' },
          { type: 'effort-update', effort: 'xhigh' },
        ),
      ),
    ).toEqual({ model: 'grok-turn', effort: 'xhigh' });
    expect(
      newlyConfirmedStartupSelection(
        requested,
        initial,
        events(
          { type: 'model-update', model: 'newer-live-model' },
          { type: 'effort-update', effort: 'high' },
        ),
      ),
    ).toEqual({});
  });
});
