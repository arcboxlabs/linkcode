import type { SessionId, WorkspaceId } from '@linkcode/schema';
import { falseFn, trueFn } from 'foxts/noop';
import { describe, expect, it } from 'vitest';
import type { NavHistoryStacks, NavLocation } from '../history';
import { locationsEqual, recordTransition, travel } from '../history';

function thread(id: string): NavLocation {
  return { surface: 'thread', sessionId: id as SessionId };
}

function draft(workspaceId: string | null = null): NavLocation {
  return { surface: 'new-thread', workspaceId: workspaceId as WorkspaceId | null };
}

const EMPTY: NavHistoryStacks = { back: [], forward: [] };

describe('locationsEqual', () => {
  it('compares by surface and identity', () => {
    expect(locationsEqual(thread('a'), thread('a'))).toBe(true);
    expect(locationsEqual(thread('a'), thread('b'))).toBe(false);
    expect(locationsEqual(draft('w1'), draft('w1'))).toBe(true);
    expect(locationsEqual(draft('w1'), draft('w2'))).toBe(false);
    expect(locationsEqual(draft(), thread('a'))).toBe(false);
  });
});

describe('recordTransition', () => {
  it('pushes the origin and clears the forward stack', () => {
    const stacks = recordTransition({ back: [], forward: [thread('c')] }, thread('a'), thread('b'));
    expect(stacks).toEqual({ back: [thread('a')], forward: [] });
  });

  it('ignores a navigation to the current location', () => {
    const stacks: NavHistoryStacks = { back: [thread('x')], forward: [thread('y')] };
    expect(recordTransition(stacks, thread('a'), thread('a'))).toBe(stacks);
  });

  it('records nothing for a null origin but still branches the timeline', () => {
    const stacks = recordTransition(
      { back: [thread('x')], forward: [thread('c')] },
      null,
      thread('b'),
    );
    expect(stacks).toEqual({ back: [thread('x')], forward: [] });
  });

  it('caps the back stack by dropping the oldest entries', () => {
    let stacks = EMPTY;
    for (let index = 0; index < 60; index += 1) {
      stacks = recordTransition(stacks, thread(`t${index}`), thread(`t${index + 1}`));
    }
    expect(stacks.back).toHaveLength(50);
    expect(stacks.back[0]).toEqual(thread('t10'));
    expect(stacks.back.at(-1)).toEqual(thread('t59'));
  });
});

describe('travel', () => {
  it('round-trips: back returns the origin, forward returns to where you were', () => {
    const recorded = recordTransition(EMPTY, thread('a'), thread('b'));

    const wentBack = travel(recorded, 'back', thread('b'), trueFn);
    expect(wentBack.target).toEqual(thread('a'));
    expect(wentBack.stacks).toEqual({ back: [], forward: [thread('b')] });

    const wentForward = travel(wentBack.stacks, 'forward', thread('a'), trueFn);
    expect(wentForward.target).toEqual(thread('b'));
    expect(wentForward.stacks).toEqual({ back: [thread('a')], forward: [] });
  });

  it('drops unreachable entries and lands on the next reachable one', () => {
    const stacks: NavHistoryStacks = { back: [thread('a'), thread('dead')], forward: [] };
    const { stacks: next, target } = travel(
      stacks,
      'back',
      thread('c'),
      (location) => !locationsEqual(location, thread('dead')),
    );
    expect(target).toEqual(thread('a'));
    expect(next).toEqual({ back: [], forward: [thread('c')] });
  });

  it('returns null and keeps the opposite stack when every entry is unreachable', () => {
    const stacks: NavHistoryStacks = { back: [thread('dead')], forward: [thread('f')] };
    const { stacks: next, target } = travel(stacks, 'back', thread('c'), falseFn);
    expect(target).toBeNull();
    expect(next).toEqual({ back: [], forward: [thread('f')] });
  });

  it('returns null on an empty stack', () => {
    expect(travel(EMPTY, 'back', thread('a'), trueFn).target).toBeNull();
    expect(travel(EMPTY, 'forward', null, trueFn).target).toBeNull();
  });

  it('does not grow the opposite stack from a null current location', () => {
    const stacks: NavHistoryStacks = { back: [draft()], forward: [] };
    const { stacks: next, target } = travel(stacks, 'back', null, trueFn);
    expect(target).toEqual(draft());
    expect(next).toEqual({ back: [], forward: [] });
  });

  it('traverses draft locations like any other entry', () => {
    const recorded = recordTransition(EMPTY, draft('w1'), thread('b'));
    const { target } = travel(recorded, 'back', thread('b'), trueFn);
    expect(target).toEqual(draft('w1'));
  });
});
