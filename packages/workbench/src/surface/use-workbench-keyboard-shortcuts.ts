import { useKeyboardShortcut } from '@linkcode/ui';
import { useCommandPaletteStore } from '../palette/store';

const PALETTE_SHORTCUT = { code: 'KeyK', modifiers: ['primary'] } as const;

export function useWorkbenchKeyboardShortcuts(owner: React.RefObject<Element | null>): void {
  useKeyboardShortcut({
    actionId: 'workbench.command-palette',
    shortcut: PALETTE_SHORTCUT,
    owner,
    handler() {
      useCommandPaletteStore.getState().toggle();
      return true;
    },
  });
}
