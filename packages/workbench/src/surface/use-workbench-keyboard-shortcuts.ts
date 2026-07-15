import type { SessionInfo } from '@linkcode/schema';
import { useKeyboardShortcut } from '@linkcode/ui';
import { createFixedArray } from 'foxts/create-fixed-array';
import { matchPaletteThreads } from '../palette/match';
import { useCommandPaletteStore } from '../palette/store';
import type { WorkbenchSessions } from './use-workbench-sessions';

const PALETTE_SHORTCUT = { code: 'KeyK', modifiers: ['primary'] } as const;

/** ⌘1–⌘9 slots; matches the palette's Recent list cap (`THREAD_RESULT_LIMIT`). */
export const RECENT_THREAD_JUMP_SLOTS = 9;

/** The palette reads its per-row `⌘n` hints from the registry labels under these ids. */
export function recentThreadJumpActionId(slot: number): string {
  return `workbench.jump-recent-thread-${slot}`;
}

const JUMP_SHORTCUTS: ReadonlyArray<{ code: string; modifiers: readonly ['primary'] }> =
  createFixedArray(RECENT_THREAD_JUMP_SLOTS).map((index) => ({
    code: `Digit${index + 1}`,
    modifiers: ['primary'],
  }));

/**
 * The palette's empty-query Recent ordering over raw sessions. Title/workspace never affect the
 * empty-query path, so bare wrappers keep the ⌘n targets in lockstep with what the palette shows.
 */
function recentThreads(sessions: readonly SessionInfo[]): SessionInfo[] {
  return matchPaletteThreads(
    sessions.map((session) => ({ session, title: '', workspaceLabel: null })),
    '',
  ).map((candidate) => candidate.session);
}

export function useWorkbenchKeyboardShortcuts(
  owner: React.RefObject<Element | null>,
  sessions: WorkbenchSessions,
): void {
  useKeyboardShortcut({
    actionId: 'workbench.command-palette',
    shortcut: PALETTE_SHORTCUT,
    owner,
    handler() {
      useCommandPaletteStore.getState().toggle();
      return true;
    },
  });

  // Nine static registrations (hooks cannot loop); distinct actionIds give each slot its own
  // registry label, which is what the palette rows display — hints match bindings by construction.
  useRecentThreadJump(owner, sessions, 1);
  useRecentThreadJump(owner, sessions, 2);
  useRecentThreadJump(owner, sessions, 3);
  useRecentThreadJump(owner, sessions, 4);
  useRecentThreadJump(owner, sessions, 5);
  useRecentThreadJump(owner, sessions, 6);
  useRecentThreadJump(owner, sessions, 7);
  useRecentThreadJump(owner, sessions, 8);
  useRecentThreadJump(owner, sessions, 9);
}

function useRecentThreadJump(
  owner: React.RefObject<Element | null>,
  sessions: WorkbenchSessions,
  slot: number,
): void {
  useKeyboardShortcut({
    actionId: recentThreadJumpActionId(slot),
    shortcut: JUMP_SHORTCUTS[slot - 1],
    owner,
    handler() {
      const target = recentThreads(sessions.sessions).at(slot - 1);
      // An empty slot yields the event (in a browser, ⌘n falls back to native tab switching).
      if (target === undefined) return false;
      sessions.select(target.sessionId);
      return true;
    },
  });
}
