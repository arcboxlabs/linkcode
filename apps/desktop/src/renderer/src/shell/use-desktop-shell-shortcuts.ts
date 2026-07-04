import type { PanelSide } from '@linkcode/ui/shell/panels';
import { useCommandPaletteStore } from '@linkcode/workbench';
import { useAbortableEffect } from 'foxact/use-abortable-effect';
import { useDesktopSettingsStore } from '../settings/store';

export function getPanelToggleShortcuts(platform: NodeJS.Platform | null): {
  sidebar?: string;
  bottom?: string;
  right?: string;
  palette?: string;
  settings?: string;
} {
  if (platform === null) return {};
  if (platform === 'darwin') {
    return { sidebar: '⌘B', bottom: '⌘J', right: '⌥⌘B', palette: '⌘K', settings: '⌘,' };
  }
  return {
    sidebar: 'Ctrl+B',
    bottom: 'Ctrl+J',
    right: 'Ctrl+Alt+B',
    palette: 'Ctrl+K',
    settings: 'Ctrl+,',
  };
}

interface UseDesktopShellShortcutsOptions {
  desktopPlatform: NodeJS.Platform | null;
  togglePanel: (side: PanelSide) => void;
  updateSidebarOpen: (updater: boolean | ((current: boolean) => boolean)) => void;
}

/**
 * Cmd+J (Ctrl+J off-mac) toggles the bottom terminal panel, Cmd+B (Ctrl+B) the sidebar,
 * Option+Cmd+B (Ctrl+Alt+B) the right side panel, and Cmd+K (Ctrl+K) the command palette.
 * Captured at the window so they win even while the terminal canvas holds focus; on mac the
 * Ctrl variants stay with the shell (Ctrl+J is a real terminal keystroke there). Matched on
 * `code` because Option rewrites `key` on mac (⌥B yields "∫").
 */
export function useDesktopShellShortcuts({
  desktopPlatform,
  togglePanel,
  updateSidebarOpen,
}: UseDesktopShellShortcutsOptions): void {
  useAbortableEffect(
    (signal) => {
      if (desktopPlatform === null) return;
      const isMac = desktopPlatform === 'darwin';
      window.addEventListener(
        'keydown',
        (event) => {
          // `inert` on the hidden workbench doesn't stop window-level listeners, so Settings
          // being open must be checked here at event time — not in the effect deps, or the
          // listener would re-register on every open/close.
          if (useDesktopSettingsStore.getState().settingsOpen) return;
          const modifier = isMac
            ? event.metaKey && !event.ctrlKey
            : event.ctrlKey && !event.metaKey;
          if (!modifier || event.shiftKey) return;
          const toggle =
            event.code === 'KeyJ' && !event.altKey
              ? () => togglePanel('bottom')
              : event.code === 'KeyB'
                ? event.altKey
                  ? () => togglePanel('right')
                  : () => updateSidebarOpen((open) => !open)
                : event.code === 'KeyK' && !event.altKey
                  ? () => useCommandPaletteStore.getState().toggle()
                  : null;
          if (toggle === null) return;
          event.preventDefault();
          event.stopPropagation();
          toggle();
        },
        { capture: true, signal },
      );
    },
    [desktopPlatform, togglePanel, updateSidebarOpen],
  );
}
