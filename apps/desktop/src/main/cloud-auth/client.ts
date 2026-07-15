import { resolve } from 'node:path';
import { electronClient } from '@better-auth/electron/client';
import { createAuthClient } from 'better-auth/client';
import { app, BrowserWindow, ipcMain } from 'electron';
import { CLOUD_CLAIM_DEEP_LINK_CHANNEL } from '../../shared/cloud';
import { CHANNEL } from '../constants';
import { createSafeStorage } from './storage';

/**
 * LinkCode Cloud (linkcodehq) endpoints. The desktop app authenticates against the Hono API
 * (`baseURL`) but the sign-in flow itself runs in the system browser on the web origin
 * (`signInURL`), which bounces through the central IdP and deep-links back via `linkcode://`.
 * Production is the default even for dev shells (there is no local cloud stack); the env
 * overrides point a developer at a local/staging server when they do run one.
 */
export const CLOUD_API_URL = process.env.LINKCODE_CLOUD_API_URL ?? 'https://api.linkcode.ai';

/**
 * The custom protocol registered for OAuth deep-link callbacks; trusted by linkcodehq. Split per
 * channel so a `development` build (which every `pnpm dev`, locally packaged dev shell, and prod
 * bundle run by the dev Electron all resolve to — see constants.ts) never fights the installed
 * `release` app over the OS-global scheme: whoever registered `linkcode://` last would otherwise
 * win, silently routing the callback to the wrong app.
 */
export const CLOUD_AUTH_SCHEME = CHANNEL === 'development' ? 'linkcode-dev' : 'linkcode';

// The HQ sign-in page decides which scheme to deep-link back on; tell it via the URL so a
// development build's callback targets linkcode-dev:// instead of the release linkcode://. The
// better-auth client appends its own params with `URL.searchParams.set`, preserving this one.
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
 * Wire the auth client into the main process. Each feature must be opted into explicitly once a
 * config object is passed: `scheme` registers the `linkcode://` protocol + deep-link handlers,
 * `bridges` registers the IPC handlers the preload invokes. CSP is left off — the renderer never
 * talks to the cloud API directly, only through the bridges.
 */
export function setupCloudAuth(): void {
  authClient.setupMain({
    csp: false,
    scheme: true,
    bridges: true,
    getWindow: () => BrowserWindow.getAllWindows().at(0) ?? null,
  });
  // Re-assert this app as the scheme's OS default handler on demand. The renderer calls this right
  // before a sign-in, so the OAuth callback deep-link routes back to THIS running app even if a
  // `pnpm dev` instance (same `linkcode-dev://`) registered the scheme after startup. Mirrors the
  // plugin's own registration (dev shells must pass execPath + entry argv, packaged builds don't).
  ipcMain.handle(CLOUD_CLAIM_DEEP_LINK_CHANNEL, () =>
    process.defaultApp && typeof process.argv[1] === 'string'
      ? app.setAsDefaultProtocolClient(CLOUD_AUTH_SCHEME, process.execPath, [
          resolve(process.argv[1]),
        ])
      : app.setAsDefaultProtocolClient(CLOUD_AUTH_SCHEME),
  );
}
