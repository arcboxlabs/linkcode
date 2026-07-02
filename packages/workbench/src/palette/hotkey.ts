import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useCommandPaletteStore } from './store';

export interface CommandPaletteHotkeyOptions {
  /** ⌘K on mac, Ctrl+K elsewhere — the Ctrl variant stays with the terminal on mac. */
  isMac: boolean;
  /** Checked at event time; return false to ignore the shortcut (e.g. while an overlay owns the keyboard). */
  isEnabled?: () => boolean;
}

/**
 * Window-level ⌘K / Ctrl+K toggle for the command palette. Captured so it wins even while the
 * terminal canvas holds focus (the terminal loses ⌘K-clear), matched on `code` because modifiers
 * rewrite `key` on mac. Register once per app — the desktop shell folds it into its own central
 * keydown listener instead of calling this hook.
 */
export function useCommandPaletteHotkey({ isMac, isEnabled }: CommandPaletteHotkeyOptions): void {
  useAbortableEffect(
    (signal) => {
      window.addEventListener(
        'keydown',
        (event) => {
          if (event.code !== 'KeyK' || event.altKey || event.shiftKey) return;
          const modifier = isMac
            ? event.metaKey && !event.ctrlKey
            : event.ctrlKey && !event.metaKey;
          if (!modifier) return;
          if (isEnabled && !isEnabled()) return;
          event.preventDefault();
          event.stopPropagation();
          useCommandPaletteStore.getState().toggle();
        },
        { capture: true, signal },
      );
    },
    [isMac, isEnabled],
  );
}
