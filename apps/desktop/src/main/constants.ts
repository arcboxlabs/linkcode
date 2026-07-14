import { parseProfileName } from '@linkcode/schema/daemon-runtime-constants';
import { app, dialog } from 'electron';
import { extractErrorMessage } from 'foxts/extract-error-message';

/**
 * The desktop identity is two orthogonal axes, and every OS-facing surface (app name, `userData`,
 * single-instance lock, safeStorage keychain entry, AppUserModelID, log files) derives from them:
 *
 * - **channel** — `development` is any build that is not the released app: `electron-vite dev`
 *   (MODE=development), locally packaged dev builds (`package`, MODE=devshell), and production
 *   bundles run by the dev Electron binary (`electron .`, where `app.isPackaged` is false). It
 *   runs under a distinct app name so it coexists with an installed release instead of clobbering
 *   its settings, stealing its instance lock, or creating its safeStorage key under the dev
 *   binary's code signature (which makes the release app prompt for the keychain password).
 * - **profile** — an optional, explicitly requested isolated universe (`--profile=<name>` or
 *   `LINKCODE_PROFILE`), forking the same surfaces again so several instances of the same channel
 *   can run side by side. The desktop passes it on to the daemon it supervises, which forks its
 *   state dir (`~/.linkcode-<name>`) and device identity with it — see `apps/daemon/src/config.ts`.
 */
export type Channel = 'release' | 'development';

export const CHANNEL: Channel =
  import.meta.env.MODE !== 'production' || !app.isPackaged ? 'development' : 'release';

function resolveProfile(): string | undefined {
  // An explicit switch outranks the inherited environment.
  const raw = app.commandLine.getSwitchValue('profile') || process.env.LINKCODE_PROFILE;
  try {
    return parseProfileName(raw === '' ? undefined : raw);
  } catch (err) {
    // A typo must abort visibly, not silently land the run in the default universe.
    dialog.showErrorBox('LinkCode', extractErrorMessage(err) ?? 'invalid profile name');
    app.exit(1);
    throw err;
  }
}

/** The requested profile; `undefined` is the default universe (every pre-profile install). */
export const PROFILE = resolveProfile();

const BASE_NAME = CHANNEL === 'development' ? 'LinkCode Development' : 'LinkCode';

export const APP_NAME = PROFILE === undefined ? BASE_NAME : `${BASE_NAME} (${PROFILE})`;

/**
 * Windows AppUserModelID — mirrors the electron-builder `appId`. Windows keys the taskbar icon,
 * pinning, and notification identity off this; without setting it at runtime the taskbar shows a
 * blank/default icon. Channel and profile get distinct ids so they neither steal the installed
 * release's taskbar slot nor its notifications (same isolation rationale as `APP_NAME`).
 */
const BASE_ID =
  CHANNEL === 'development'
    ? 'com.arcboxlabs.linkcode.desktop.development'
    : 'com.arcboxlabs.linkcode.desktop';

export const APP_ID = PROFILE === undefined ? BASE_ID : `${BASE_ID}.${PROFILE}`;

/** `~/LinkCode` holds user workspaces — shared across channels and profiles on purpose. */
export const DEFAULT_WORKSPACES_DIRNAME = 'LinkCode';
