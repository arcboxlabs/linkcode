import type { PanelSide } from '@linkcode/ui/shell/panels';
import type { PaletteCommand } from '@linkcode/workbench';
import { useCommandPaletteStore } from '@linkcode/workbench';
import { noop } from 'foxact/noop';
import { useAbortableEffect } from 'foxact/use-abortable-effect';
import { useTranslations } from 'use-intl';
import { useDesktopSettingsStore } from '../settings/store';
import { getPanelToggleShortcuts } from './use-desktop-shell-shortcuts';

interface UseDesktopPaletteCommandsOptions {
  desktopPlatform: NodeJS.Platform | null;
  pickDirectory: () => Promise<string | null>;
  onRegisterWorkspace: (cwd: string) => void;
  onOpenSettings?: () => void;
  togglePanel: (side: PanelSide) => void;
  updateSidebarOpen: (updater: boolean | ((current: boolean) => boolean)) => void;
}

/**
 * Desktop-owned palette entries: native folder pick, the Settings overlay (plus a deep link to
 * its Import-chat-history pane), and the panel toggles. Registered into the shared palette store
 * so the workbench-rendered palette lists them without desktop threading props through the
 * surface.
 */
export function useDesktopPaletteCommands({
  desktopPlatform,
  pickDirectory,
  onRegisterWorkspace,
  onOpenSettings,
  togglePanel,
  updateSidebarOpen,
}: UseDesktopPaletteCommandsOptions): void {
  const tPalette = useTranslations('workbench.palette');

  useAbortableEffect(() => {
    const shortcuts = getPanelToggleShortcuts(desktopPlatform);
    const commands: PaletteCommand[] = [
      {
        id: 'desktop.open-folder',
        label: tPalette('openFolder'),
        keywords: ['folder', 'workspace'],
        run() {
          // The native picker only yields existing directories, so registration failing is a
          // transport-level problem already surfaced by the data layer's error reporting.
          void pickDirectory()
            .then((picked) => (picked ? onRegisterWorkspace(picked) : null))
            .catch(noop);
        },
      },
      {
        id: 'desktop.toggle-sidebar',
        label: tPalette('toggleSidebar'),
        shortcut: shortcuts.sidebar,
        run() {
          updateSidebarOpen((open) => !open);
        },
      },
      {
        id: 'desktop.toggle-bottom-panel',
        label: tPalette('toggleBottomPanel'),
        shortcut: shortcuts.bottom,
        run() {
          togglePanel('bottom');
        },
      },
      {
        id: 'desktop.toggle-right-panel',
        label: tPalette('toggleRightPanel'),
        shortcut: shortcuts.right,
        run() {
          togglePanel('right');
        },
      },
    ];
    if (onOpenSettings) {
      commands.splice(
        1,
        0,
        {
          id: 'desktop.settings',
          label: tPalette('openSettings'),
          shortcut: shortcuts.settings,
          run: onOpenSettings,
        },
        {
          id: 'desktop.import-history',
          label: tPalette('importHistory'),
          keywords: ['history', 'import', 'chat'],
          run() {
            // Deep-link the Settings overlay to the Import-chat-history pane; the category is
            // store-held, so it survives until SettingsView mounts.
            useDesktopSettingsStore.getState().setSettingsCategory('history-import');
            onOpenSettings();
          },
        },
      );
    }
    const { registerCommands, unregisterCommands } = useCommandPaletteStore.getState();
    registerCommands('desktop', commands);
    return () => unregisterCommands('desktop');
  }, [
    desktopPlatform,
    tPalette,
    pickDirectory,
    onRegisterWorkspace,
    onOpenSettings,
    togglePanel,
    updateSidebarOpen,
  ]);
}
