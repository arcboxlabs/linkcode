/**
 * Type surface for the LinkCode Cloud auth bridges the preload exposes on `window` via the
 * better-auth electron plugin (`@better-auth/electron/preload`). Kept as an explicit contract
 * because the bridge lives in the main process — the renderer can't import its inferred type
 * across the process boundary, so we mirror the vendor's stable public shape here.
 */

import type { CloudHost, CloudImSource } from '@linkcode/workbench';

/** The authenticated user, as normalized by the electron plugin. Extra IdP fields are preserved. */
export interface CloudUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  [key: string]: unknown;
}

/** Options accepted by `requestAuth` — mirrors the plugin's request-auth schema (all optional). */
export interface RequestAuthOptions {
  provider?: string;
  callbackURL?: string;
  scopes?: string[];
}

/**
 * Cloud-account data bridge (exposed as `window.linkcodeCloud`). Distinct from the auth bridges above:
 * these read cloud data the main process fetches with the keychain session, not window/OS capabilities.
 */
export interface CloudDataBridges {
  linkcodeCloud: {
    /** Lists the signed-in account's online hosts; main attaches the session and validates. */
    listHosts: () => Promise<CloudHost[]>;
    /** IM Channel management (`/im/*`); same session-in-main model as listHosts. */
    im: CloudImSource;
  };
}

export interface CloudAuthBridges {
  /** Current user from the persisted session, or null when signed out. Used to seed on boot. */
  getUser: () => Promise<CloudUser | null>;
  /** Opens the system browser to the cloud sign-in flow. Resolves once the browser is launched. */
  requestAuth: (options?: RequestAuthOptions) => Promise<void>;
  signOut: () => Promise<void>;
  /** Manual authorization-code exchange — a fallback for when the deep link cannot be delivered. */
  authenticate: (data: { token: string }) => Promise<void>;
  onAuthenticated: (callback: (user: CloudUser) => void) => () => void;
  onUserUpdated: (callback: (user: CloudUser | null) => void) => () => void;
  onAuthError: (callback: (context: unknown) => void) => () => void;
}

declare global {
  interface Window extends CloudAuthBridges, CloudDataBridges {}
}
