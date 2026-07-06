import { electronClient } from '@better-auth/electron/client';
import { createAuthClient } from 'better-auth/client';
import { BrowserWindow } from 'electron';
import { createSafeStorage } from './storage';

/**
 * LinkCode Cloud (linkcodehq) endpoints. The desktop app authenticates against the Hono API
 * (`baseURL`) but the sign-in flow itself runs in the system browser on the web origin
 * (`signInURL`), which bounces through the central IdP and deep-links back via `linkcode://`.
 * Production is the default even for dev shells (there is no local cloud stack); the env
 * overrides point a developer at a local/staging server when they do run one.
 */
const CLOUD_API_URL = process.env.LINKCODE_CLOUD_API_URL ?? 'https://api.linkcode.ai';

const CLOUD_SIGN_IN_URL = process.env.LINKCODE_CLOUD_SIGN_IN_URL ?? 'https://linkcode.ai/sign-in';

/** The custom protocol registered for OAuth deep-link callbacks; trusted by linkcodehq. */
export const CLOUD_AUTH_SCHEME = 'linkcode';

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
}
