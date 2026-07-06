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
  plugins: [
    electronClient({
      signInURL: CLOUD_SIGN_IN_URL,
      protocol: { scheme: CLOUD_AUTH_SCHEME },
      storage: createSafeStorage(),
    }),
  ],
});

export type CloudAuthClient = typeof authClient;

/**
 * Wire the auth client into the main process: registers the `linkcode://` protocol, the deep-link
 * handlers, and the IPC bridges the preload exposes. CSP is left to the renderer's own meta policy
 * — the renderer never talks to the cloud API directly, only through these bridges.
 */
export function setupCloudAuth(): void {
  authClient.setupMain({
    csp: false,
    getWindow: () => BrowserWindow.getAllWindows().at(0) ?? null,
  });
}
