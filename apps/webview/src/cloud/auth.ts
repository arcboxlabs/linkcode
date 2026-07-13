import { createAuthClient } from 'better-auth/react';

/**
 * LinkCode Cloud auth for the browser shell. The session cookie is shared with the API via
 * `.linkcode.ai` (the webview deploys on an api-adjacent subdomain; see COOKIE_DOMAIN in hq).
 * Dev against a local cloud stack overrides the URL; localhost against production will not
 * receive the cross-site cookie and stays signed out.
 */
export const CLOUD_API_URL =
  (import.meta.env.VITE_LINKCODE_CLOUD_API_URL as string | undefined) ?? 'https://api.linkcode.ai';

export const authClient = createAuthClient({
  baseURL: CLOUD_API_URL,
  // The API mounts better-auth at /auth, not the client default /api/auth.
  basePath: '/auth',
  fetchOptions: { credentials: 'include' },
});

/**
 * Kicks off the central-IdP redirect flow, returning to the current page when done. As of
 * better-auth 1.7, generic OAuth providers share the social sign-in flow and callback route.
 */
export function signInWithCloud(): void {
  void authClient.signIn.social({
    provider: 'central-idp',
    callbackURL: window.location.href,
  });
}
