import { app } from 'electron';

/**
 * A dev shell is any build that is not the released app: `electron-vite dev` (MODE=development),
 * locally packaged dev builds (`package`, MODE=devshell), and production builds run by the dev
 * Electron binary (`electron-vite preview` / `electron .`, where `app.isPackaged` is false). It
 * runs under a distinct app name — and therefore a distinct `userData` dir, single-instance lock,
 * and OS keychain entry — so it coexists with an installed release LinkCode instead of clobbering
 * its settings, stealing its instance lock, or creating its safeStorage key under the dev
 * binary's code signature (which makes the release app prompt for the keychain password).
 */
export const IS_DEV_SHELL = import.meta.env.MODE !== 'production' || !app.isPackaged;

export const APP_NAME = IS_DEV_SHELL ? 'LinkCode Dev' : 'LinkCode';

/** `~/LinkCode` holds user workspaces — shared between dev and release shells on purpose. */
export const DEFAULT_WORKSPACES_DIRNAME = 'LinkCode';
