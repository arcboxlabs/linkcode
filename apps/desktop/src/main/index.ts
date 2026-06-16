import { join } from 'node:path';
import { type IpcCallEnvelope, type SystemContext, dispatchSystemCall } from '@linkcode/ipc';
import { BrowserWindow, app, dialog, ipcMain } from 'electron';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0e0f12',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  win.on('ready-to-show', () => win.show());

  // electron-vite 开发模式注入渲染层 URL；生产加载打包后的 html。
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

/** 把 TypeSafe IPC 的能力契约绑定到真实 Electron 实现（仅系统 / UI，PLAN §2.3）。 */
function systemContextFor(win: BrowserWindow): SystemContext {
  return {
    window: {
      minimize: () => win.minimize(),
      toggleMaximize: () => {
        if (win.isMaximized()) win.unmaximize();
        else win.maximize();
      },
      close: () => win.close(),
      isMaximized: () => win.isMaximized(),
    },
    dialog: {
      pickFile: async (opts) => {
        const result = await dialog.showOpenDialog(win, {
          title: opts?.title,
          properties: [opts?.directory ? 'openDirectory' : 'openFile'],
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return result.filePaths[0];
      },
    },
    app: {
      getVersion: () => app.getVersion(),
      getPlatform: () => process.platform,
    },
  };
}

app
  .whenReady()
  .then(() => {
    const win = createWindow();
    const ctx = systemContextFor(win);

    // 数据面绝不走这里；这里只处理 systemRouter 定义的系统 / UI 调用（PLAN §2.3）。
    ipcMain.handle('linkcode:ipc', (_event, call: IpcCallEnvelope) =>
      dispatchSystemCall(ctx, call),
    );

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((err) => {
    console.error('[link-code/desktop] failed to start:', err);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
