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

/**
 * Windows AppUserModelID — mirrors the electron-builder `appId`. Windows keys the taskbar icon,
 * pinning, and notification identity off this; without setting it at runtime the taskbar shows a
 * blank/default icon. A dev shell gets a distinct id so it neither steals the installed release's
 * taskbar slot nor its notifications (same isolation rationale as `APP_NAME`).
 */
export const APP_ID = IS_DEV_SHELL
  ? 'com.arcboxlabs.linkcode.desktop.dev'
  : 'com.arcboxlabs.linkcode.desktop';

/** `~/LinkCode` holds user workspaces — shared between dev and release shells on purpose. */
export const DEFAULT_WORKSPACES_DIRNAME = 'LinkCode';
