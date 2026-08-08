import type { ProductChannel } from '@linkcode/schema/daemon-runtime';
import { parseProfileName } from '@linkcode/schema/daemon-runtime';
import { workspacesDirName } from '@linkcode/schema/product';
import { app, dialog } from 'electron';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { deriveDesktopBrandBase, parseDesktopBrandIdentity } from './brand';

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
export type Channel = ProductChannel;

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

/** Build-time brand identity (CODE-558): null on default LinkCode builds. A malformed inlined
 * artifact throws here and aborts boot — a branded build must never fall back to LinkCode. */
const BRAND = parseDesktopBrandIdentity(import.meta.env.MAIN_VITE_BRAND_IDENTITY);
const BRAND_BASE = BRAND === null ? null : deriveDesktopBrandBase(BRAND, CHANNEL);

const BASE_NAME =
  BRAND_BASE?.appName ?? (CHANNEL === 'development' ? 'LinkCode Development' : 'LinkCode');

export const APP_NAME = PROFILE === undefined ? BASE_NAME : `${BASE_NAME} (${PROFILE})`;

/**
 * Windows AppUserModelID — mirrors the electron-builder `appId`. Windows keys the taskbar icon,
 * pinning, and notification identity off this (unset = blank/default taskbar icon); channel and
 * profile get distinct ids for the same isolation rationale as `APP_NAME`.
 */
const BASE_ID =
  BRAND_BASE?.appId ??
  (CHANNEL === 'development'
    ? 'com.arcboxlabs.linkcode.desktop.development'
    : 'com.arcboxlabs.linkcode.desktop');

export const APP_ID = PROFILE === undefined ? BASE_ID : `${BASE_ID}.${PROFILE}`;

/**
 * The brand's on-disk storage universe (`userData` directory name, see identity.ts). Without a
 * brand this is exactly APP_NAME — the pre-CODE-558 value, so existing installs keep their data.
 * With a brand it is the publisher's storageNamespace (channel/profile-forked like APP_NAME);
 * each brand only ever resolves its own namespace and never migrates or reads another's.
 */
const STORAGE_BASE = BRAND_BASE?.storageDirName ?? BASE_NAME;

export const STORAGE_DIR_NAME =
  PROFILE === undefined ? STORAGE_BASE : `${STORAGE_BASE} (${PROFILE})`;

/**
 * OAuth deep-link protocol (see cloud-auth/client.ts): brand-owned when a brand identity is
 * embedded, split per channel so a development build never fights the installed release over
 * the OS-global scheme.
 */
export const CLOUD_AUTH_SCHEME =
  BRAND_BASE?.authScheme ?? (CHANNEL === 'development' ? 'linkcode-dev' : 'linkcode');

/** The channel's workspace directory (`~/LinkCode`, `~/LinkCode Development`) — shared across
 * that channel's profiles on purpose, but never across channels (CODE-460). Must agree with the
 * daemon's `chatWorkspaceRoot()`, which derives the same name from its own resolved channel. */
export const DEFAULT_WORKSPACES_DIRNAME = workspacesDirName(CHANNEL);
