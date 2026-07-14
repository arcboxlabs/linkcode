import { join } from 'node:path';
import { app } from 'electron';
import log from 'electron-log';
import { APP_ID, APP_NAME } from './constants';

/**
 * Applies the channel × profile identity (see constants.ts) as an import side effect. This module
 * must stay the FIRST import of main's index.ts: ESM runs imported module bodies before the
 * importer's own statements, so any module that captures a path before these lines lands in the
 * wrong universe — that is exactly how cloud-auth once leaked dev-shell session data into the
 * release profile (CODE-166).
 */

app.setName(APP_NAME);
// setName alone is not enough: Electron pins userData from package.json's productName before
// any app code runs, and electron-builder bakes the release productName ("LinkCode") into the
// asar even for dev-shell packages. Without this, a packaged dev shell shares the release app's
// settings and single-instance lock — the second one to start exits silently.
app.setPath('userData', join(app.getPath('appData'), APP_NAME));

// Windows keys the taskbar icon, pinning, and notification identity off the AppUserModelID; without
// this the taskbar shows a blank/default icon. No-op on macOS/Linux.
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

// Self-evidence for identity drift: any module that resolves a path before the lines above
// lands in the wrong profile, and this line makes that visible on day one.
log.info(`userData: ${app.getPath('userData')}`);
