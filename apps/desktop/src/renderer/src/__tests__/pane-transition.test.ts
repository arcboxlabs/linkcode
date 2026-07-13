import type { SplitTransitionState } from '@renderer/shell/layout/pane-transition';
import { reconcileTransition, settleTransition } from '@renderer/shell/layout/pane-transition';
import { describe, expect, it } from 'vitest';

function transition(overrides?: Partial<SplitTransitionState>): SplitTransitionState {
  return {
    requestedOpen: false,
    phase: 'closed',
    version: 0,
    ...overrides,
  };
}

describe('reconcileTransition', () => {
  it('returns the same reference when the request is unchanged', () => {
    const current = transition({ requestedOpen: true, phase: 'open', version: 3 });

    expect(reconcileTransition(current, true, false)).toBe(current);
  });

  it('animates open from closed with a version bump', () => {
    const current = transition({ requestedOpen: false, phase: 'closed', version: 1 });

    const next = reconcileTransition(current, true, false);

    expect(next).not.toBe(current);
    expect(next).toEqual({ requestedOpen: true, phase: 'opening', version: 2 });
  });

  it('animates closed', () => {
    const current = transition({ requestedOpen: true, phase: 'open', version: 5 });

    const next = reconcileTransition(current, false, false);

    expect(next).toEqual({ requestedOpen: false, phase: 'closing', version: 6 });
  });

  it('re-enters opening with a version bump when re-opening before a close has finished', () => {
    const current = transition({ requestedOpen: false, phase: 'closing', version: 2 });

    const next = reconcileTransition(current, true, false);

    expect(next).toMatchObject({ phase: 'opening', version: 3 });
  });

  it('skips the animation phases under reduced motion', () => {
    const opened = reconcileTransition(transition({ phase: 'closed' }), true, true);
    expect(opened).toMatchObject({ phase: 'open' });

    const closed = reconcileTransition(
      transition({ requestedOpen: true, phase: 'open' }),
      false,
      true,
    );
    expect(closed).toMatchObject({ phase: 'closed' });
  });

  it('settles an in-flight animation to its resting phase when reduced motion turns on', () => {
    const current = transition({ requestedOpen: true, phase: 'opening', version: 4 });

    const next = reconcileTransition(current, true, true);

    expect(next).not.toBe(current);
    expect(next).toEqual({ requestedOpen: true, phase: 'open', version: 5 });
  });

  it('does not churn the version once a reduced-motion transition has settled', () => {
    const current = transition({ requestedOpen: true, phase: 'open' });

    expect(reconcileTransition(current, true, true)).toBe(current);
  });
});

describe('settleTransition', () => {
  it('settles an active transition to the latest requested state', () => {
    expect(
      settleTransition(transition({ requestedOpen: true, phase: 'opening', version: 3 })),
    ).toEqual({ requestedOpen: true, phase: 'open', version: 3 });
    expect(
      settleTransition(transition({ requestedOpen: false, phase: 'closing', version: 4 })),
    ).toEqual({ requestedOpen: false, phase: 'closed', version: 4 });
  });

  it('keeps a settled transition reference stable', () => {
    const current = transition({ requestedOpen: true, phase: 'open', version: 2 });

    expect(settleTransition(current)).toBe(current);
  });
});
