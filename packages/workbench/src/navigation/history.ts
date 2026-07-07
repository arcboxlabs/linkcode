import type { SessionId, WorkspaceId } from '@linkcode/schema';

/** A place the workbench main surface can navigate back/forward to. */
export type NavLocation =
  | { surface: 'thread'; sessionId: SessionId }
  | { surface: 'new-thread'; workspaceId: WorkspaceId | null }
  | { surface: 'settings' };

export interface NavHistoryStacks {
  back: NavLocation[];
  forward: NavLocation[];
}

/** Oldest entries fall off first; generous for a per-window, in-memory stack. */
const MAX_STACK_SIZE = 50;

export function locationsEqual(a: NavLocation, b: NavLocation): boolean {
  if (a.surface === 'thread') {
    return b.surface === 'thread' && a.sessionId === b.sessionId;
  }
  if (a.surface === 'new-thread') {
    return b.surface === 'new-thread' && a.workspaceId === b.workspaceId;
  }
  return b.surface === 'settings';
}

/**
 * Records an explicit navigation. Two-stack model: the current location lives outside the stacks
 * (it IS the app state), so `from` is what gets pushed. Any new navigation branches the timeline —
 * the forward stack clears, browser-style.
 */
export function recordTransition(
  stacks: NavHistoryStacks,
  from: NavLocation | null,
  to: NavLocation,
): NavHistoryStacks {
  if (from !== null && locationsEqual(from, to)) return stacks;
  return {
    back: from === null ? stacks.back : [...stacks.back.slice(1 - MAX_STACK_SIZE), from],
    forward: [],
  };
}

/**
 * Pops `dir` until a reachable location surfaces, dropping unreachable entries (e.g. closed
 * sessions) on the way so they never block traversal. On a hit the current location moves onto
 * the opposite stack; when the stack exhausts, the dropped entries stay dropped (keeping
 * "can go back/forward" honest) and there is no target.
 */
export function travel(
  stacks: NavHistoryStacks,
  dir: 'back' | 'forward',
  current: NavLocation | null,
  isReachable: (location: NavLocation) => boolean,
): { stacks: NavHistoryStacks; target: NavLocation | null } {
  const source = [...stacks[dir]];
  const opposite = dir === 'back' ? stacks.forward : stacks.back;

  for (let candidate = source.pop(); candidate !== undefined; candidate = source.pop()) {
    if (!isReachable(candidate)) continue;
    const grown = current === null ? opposite : [...opposite, current];
    return {
      stacks: dir === 'back' ? { back: source, forward: grown } : { back: grown, forward: source },
      target: candidate,
    };
  }

  return {
    stacks:
      dir === 'back' ? { back: [], forward: stacks.forward } : { back: stacks.back, forward: [] },
    target: null,
  };
}
