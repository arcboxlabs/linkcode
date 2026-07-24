import { formatKeyboardShortcut } from '@linkcode/ui';
import type { PanelSide } from '@linkcode/ui/shell/panels';
import type { PaletteCommand } from '@linkcode/workbench';
import { useCommandPaletteStore } from '@linkcode/workbench';
import { noop } from 'foxact/noop';
import { useEffect } from 'foxact/use-abortable-effect';
import { useTranslations } from 'use-intl';
import { openDesktopSettings } from '../settings/store';

const SETTINGS_SHORTCUT = { code: 'Comma', modifiers: ['primary'] } as const;

interface UseDesktopPaletteCommandsOptions {
  desktopPlatform: NodeJS.Platform;
  pickDirectory: () => Promise<string | null>;
  onRegisterWorkspace: (cwd: string) => void;
  onOpenSettings?: () => void;
  togglePanel: (side: PanelSide) => void;
  updateSidebarOpen: (updater: boolean | ((current: boolean) => boolean)) => void;
}

/**
 * Desktop-owned palette entries (native folder pick, Settings overlay + its history-import deep
 * link, panel toggles), registered into the shared palette store so the workbench-rendered
 * palette lists them without desktop threading props through the surface.
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

  useEffect(() => {
    const settingsShortcut = formatKeyboardShortcut(
      SETTINGS_SHORTCUT,
      desktopPlatform === 'darwin' ? 'mac' : 'non-mac',
    );
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
        run() {
          updateSidebarOpen((open) => !open);
        },
      },
      {
        id: 'desktop.toggle-bottom-panel',
        label: tPalette('toggleBottomPanel'),
        run() {
          togglePanel('bottom');
        },
      },
      {
        id: 'desktop.toggle-right-panel',
        label: tPalette('toggleRightPanel'),
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
          shortcut: settingsShortcut,
          run: onOpenSettings,
        },
        {
          id: 'desktop.import-history',
          label: tPalette('importHistory'),
          keywords: ['history', 'import', 'chat'],
          run() {
            openDesktopSettings('history-import');
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
