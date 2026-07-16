import { resolve } from 'node:path';
import { electronClient } from '@better-auth/electron/client';
import { createAuthClient } from 'better-auth/client';
import { app, BrowserWindow, ipcMain } from 'electron';
import { CLOUD_CLAIM_DEEP_LINK_CHANNEL } from '../../shared/cloud';
import { CHANNEL } from '../constants';
import { createSafeStorage } from './storage';

/**
 * LinkCode Cloud (linkcodehq) endpoints: auth targets the Hono API (`baseURL`); sign-in runs in the
 * system browser on the web origin and deep-links back via `linkcode://`. Production is the default
 * even for dev shells (no local cloud stack); the env overrides point at a local/staging server.
 */
export const CLOUD_API_URL = process.env.LINKCODE_CLOUD_API_URL ?? 'https://api.linkcode.ai';

/**
 * OAuth deep-link protocol, trusted by linkcodehq; split per channel (see constants.ts) so a
 * `development` build never fights the installed `release` app over the OS-global scheme — the
 * last registrant would win and silently route the callback to the wrong app.
 */
export const CLOUD_AUTH_SCHEME = CHANNEL === 'development' ? 'linkcode-dev' : 'linkcode';

// Tell the HQ sign-in page which scheme to deep-link back on; the better-auth client appends its
// own params with `URL.searchParams.set`, preserving this one.
const CLOUD_SIGN_IN_URL = (() => {
  const url = new URL(process.env.LINKCODE_CLOUD_SIGN_IN_URL ?? 'https://linkcode.ai/sign-in');
  url.searchParams.set('scheme', CLOUD_AUTH_SCHEME);
  return url.href;
})();

export const authClient = createAuthClient({
  baseURL: CLOUD_API_URL,
  // The API mounts better-auth at /auth, not the client default /api/auth.
  basePath: '/auth',
  plugins: [
    electronClient({
      signInURL: CLOUD_SIGN_IN_URL,
      protocol: { scheme: CLOUD_AUTH_SCHEME },
      storage: createSafeStorage(),
      // The IdP does not return an avatar, so skip the user-image proxy (and its extra
      // privileged scheme); the footer renders initials.
      userImageProxy: { enabled: false },
    }),
  ],
});

export type CloudAuthClient = typeof authClient;

/**
 * Wire the auth client into main. Once a config object is passed, every feature must be opted into
 * explicitly: `scheme` = protocol + deep-link handlers, `bridges` = the IPC handlers the preload
 * invokes. CSP stays off — the renderer only reaches the cloud API through the bridges.
 */
export function setupCloudAuth(): void {
  authClient.setupMain({
    csp: false,
    scheme: true,
    bridges: true,
    getWindow: () => BrowserWindow.getAllWindows().at(0) ?? null,
  });
  // Re-assert this app as the scheme's OS default right before sign-in, so the callback routes to
  // THIS running app even if another instance registered the scheme after startup. Mirrors the
  // plugin's own registration (dev shells must pass execPath + entry argv, packaged builds don't).
  ipcMain.handle(CLOUD_CLAIM_DEEP_LINK_CHANNEL, () =>
    process.defaultApp && typeof process.argv[1] === 'string'
      ? app.setAsDefaultProtocolClient(CLOUD_AUTH_SCHEME, process.execPath, [
          resolve(process.argv[1]),
        ])
      : app.setAsDefaultProtocolClient(CLOUD_AUTH_SCHEME),
  );
}
