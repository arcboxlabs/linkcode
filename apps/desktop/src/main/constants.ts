import { parseProfileName } from '@linkcode/schema/daemon-runtime-constants';
import { app, dialog } from 'electron';
import { extractErrorMessage } from 'foxts/extract-error-message';

/**
 * The desktop identity is two orthogonal axes; every OS-facing surface (app name, `userData`,
 * single-instance lock, safeStorage keychain entry, AppUserModelID, log files) derives from them.
 * **channel**: `development` is any build that is not the released app — dev, devshell packs, and
 * production bundles run by the dev Electron binary (`app.isPackaged` false) — under a distinct
 * app name so it never clobbers the installed release's settings, steals its instance lock, or
 * creates its safeStorage key under the dev binary's code signature (which makes the release app
 * prompt for the keychain password). **profile**: an optional isolated universe
 * (`--profile=<name>` / `LINKCODE_PROFILE`) forking the same surfaces again; passed on to the
 * supervised daemon, which forks its state dir and device identity (see `apps/daemon/src/config.ts`).
 */
export type Channel = 'release' | 'development';

export const CHANNEL: Channel =
  import.meta.env.MODE !== 'production' || !app.isPackaged ? 'development' : 'release';

function resolveProfile(): string | undefined {
  // An explicit switch outranks the inherited environment — including a bare `--profile=`,
  // which pins the default universe (getSwitchValue alone cannot tell "absent" from "empty").
  const raw = app.commandLine.hasSwitch('profile')
    ? app.commandLine.getSwitchValue('profile')
    : process.env.LINKCODE_PROFILE;
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
 * pinning, and notification identity off this (unset = blank/default taskbar icon); channel and
 * profile get distinct ids for the same isolation rationale as `APP_NAME`.
 */
const BASE_ID =
  CHANNEL === 'development'
    ? 'com.arcboxlabs.linkcode.desktop.development'
    : 'com.arcboxlabs.linkcode.desktop';

export const APP_ID = PROFILE === undefined ? BASE_ID : `${BASE_ID}.${PROFILE}`;

/** `~/LinkCode` holds user workspaces — shared across channels and profiles on purpose. */
export const DEFAULT_WORKSPACES_DIRNAME = 'LinkCode';
