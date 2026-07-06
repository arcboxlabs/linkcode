/**
 * A dev shell is any build that is not the released app: `electron-vite dev` (MODE=development)
 * and locally packaged dev builds (`pack:dev`, MODE=devshell). It runs under a distinct app name —
 * and therefore a distinct `userData` dir and single-instance lock — so it coexists with an
 * installed release LinkCode instead of clobbering its settings or refusing to launch.
 */
export const IS_DEV_SHELL = import.meta.env.MODE !== 'production';

export const APP_NAME = IS_DEV_SHELL ? 'LinkCode Dev' : 'LinkCode';

/** `~/LinkCode` holds user workspaces — shared between dev and release shells on purpose. */
export const DEFAULT_WORKSPACES_DIRNAME = 'LinkCode';
