import { SETTINGS_OPEN_CHANNEL } from '@linkcode/ipc';
import type { MenuItemConstructorOptions } from 'electron';
import { BrowserWindow, Menu } from 'electron';
import { APP_NAME } from './constants';

/**
 * Native application menu. Setting a custom menu replaces Electron's default entirely, so the full
 * standard template (Edit/View/Window via roles) must be rebuilt — otherwise copy/paste/quit break.
 * The only addition is a "Settings…" item bound to the platform-standard `Cmd+,` accelerator, which
 * pushes an open-settings event to the focused window's renderer.
 */
function openSettings(): void {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().at(0);
  win?.webContents.send(SETTINGS_OPEN_CHANNEL);
}

export function buildAppMenu(): Menu {
  const isMac = process.platform === 'darwin';
  const settingsItem: MenuItemConstructorOptions = {
    label: 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: openSettings,
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settingsItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: isMac
        ? [{ role: 'close' }]
        : [settingsItem, { type: 'separator' }, { role: 'quit' }],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];

  return Menu.buildFromTemplate(template);
}
