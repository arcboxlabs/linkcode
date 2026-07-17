import { join } from 'node:path';
import { app } from 'electron';
import log from 'electron-log';
import { APP_ID, APP_NAME } from './constants';

/**
 * Applies the channel × profile identity (see constants.ts) as an import side effect. Must stay
 * the FIRST import of main's index.ts: any module body that captures a path before these lines
 * lands in the wrong universe — how cloud-auth leaked dev-shell session data into the release
 * profile (CODE-166).
 */

app.setName(APP_NAME);
// setName alone is not enough: Electron pins userData from the asar's productName (electron-builder
// bakes the release "LinkCode" in even for dev-shell packages), so without this a packaged dev shell
// shares the release app's settings and single-instance lock — the second one to start exits silently.
app.setPath('userData', join(app.getPath('appData'), APP_NAME));

// Windows keys the taskbar icon, pinning, and notification identity off the AppUserModelID; without
// this the taskbar shows a blank/default icon. No-op on macOS/Linux.
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

// Self-evidence for identity drift: any module that resolves a path before the lines above
// lands in the wrong profile, and this line makes that visible on day one.
log.info(`userData: ${app.getPath('userData')}`);
