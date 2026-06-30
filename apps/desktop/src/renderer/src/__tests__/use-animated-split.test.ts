import type { SplitTransitionState } from '@desktop/shell/layout/use-animated-split';
import { reconcileTransition } from '@desktop/shell/layout/use-animated-split';
import { describe, expect, it } from 'vitest';

function transition(overrides?: Partial<SplitTransitionState>): SplitTransitionState {
  return {
    requestedOpen: false,
    phase: 'closed',
    targetPaneSize: 0,
    shouldStartFromZero: false,
    version: 0,
    ...overrides,
  };
}

describe('reconcileTransition', () => {
  it('returns the same reference when the request is unchanged', () => {
    const current = transition({
      requestedOpen: true,
      phase: 'open',
      targetPaneSize: 440,
      version: 3,
    });

    expect(reconcileTransition(current, true, 440, false)).toBe(current);
  });

  it('animates open from closed, starting from zero and snapshotting the size', () => {
    const current = transition({ requestedOpen: false, phase: 'closed', version: 1 });

    const next = reconcileTransition(current, true, 440, false);

    expect(next).not.toBe(current);
    expect(next).toEqual({
      requestedOpen: true,
      phase: 'opening',
      targetPaneSize: 440,
      shouldStartFromZero: true,
      version: 2,
    });
  });

  it('animates closed, driving the target size to zero', () => {
    const current = transition({
      requestedOpen: true,
      phase: 'open',
      targetPaneSize: 440,
      version: 5,
    });

    const next = reconcileTransition(current, false, 440, false);

    expect(next).toEqual({
      requestedOpen: false,
      phase: 'closing',
      targetPaneSize: 0,
      shouldStartFromZero: false,
      version: 6,
    });
  });

  it('does not snap from zero when re-opening before a close has finished', () => {
    const current = transition({ requestedOpen: false, phase: 'closing', version: 2 });

    const next = reconcileTransition(current, true, 440, false);

    expect(next).toMatchObject({ phase: 'opening', shouldStartFromZero: false, version: 3 });
  });

  it('skips the animation phases under reduced motion', () => {
    const opened = reconcileTransition(transition({ phase: 'closed' }), true, 440, true);
    expect(opened).toMatchObject({
      phase: 'open',
      targetPaneSize: 440,
      shouldStartFromZero: false,
    });

    const closed = reconcileTransition(
      transition({ requestedOpen: true, phase: 'open', targetPaneSize: 440 }),
      false,
      440,
      true,
    );
    expect(closed).toMatchObject({
      phase: 'closed',
      targetPaneSize: 0,
      shouldStartFromZero: false,
    });
  });

  it('settles an in-flight animation to its resting phase when reduced motion turns on', () => {
    const current = transition({
      requestedOpen: true,
      phase: 'opening',
      targetPaneSize: 440,
      shouldStartFromZero: true,
      version: 4,
    });

    const next = reconcileTransition(current, true, 440, true);

    expect(next).not.toBe(current);
    expect(next).toEqual({
      requestedOpen: true,
      phase: 'open',
      targetPaneSize: 440,
      shouldStartFromZero: false,
      version: 5,
    });
  });

  it('does not churn the version once a reduced-motion transition has settled', () => {
    const current = transition({ requestedOpen: true, phase: 'open', targetPaneSize: 440 });

    expect(reconcileTransition(current, true, 440, true)).toBe(current);
  });

  it('clamps a negative requested size to zero', () => {
    const next = reconcileTransition(transition({ phase: 'closed' }), true, -50, false);

    expect(next.targetPaneSize).toBe(0);
  });
});
