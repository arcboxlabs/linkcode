/**
 * Type surface for the cloud auth bridges the preload exposes on `window`
 * (`@better-auth/electron/preload`). An explicit contract: the renderer cannot import the main
 * process's inferred types across the process boundary, so the vendor's stable shape is mirrored here.
 */

import type { CloudHost, CloudImSource } from '@linkcode/workbench';
import { traceRendererIpc } from '../ipc';

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
    /**
     * Re-asserts this app as the scheme's OS default so the OAuth callback routes back here;
     * called right before a sign-in. Resolves to whether the OS accepted it.
     */
    claimDeepLink: () => Promise<boolean>;
    /** IM Channel management (`/im/*`); same session-in-main model as listHosts. */
    im: CloudImSource;
  };
}

const cloudSource = window.linkcodeCloud;

/** First-party cloud IPC with fixed span names and no payload/result attributes. */
export const cloudDataBridge: CloudDataBridges['linkcodeCloud'] = {
  listHosts: () => traceRendererIpc('cloud.list-hosts', () => cloudSource.listHosts()),
  claimDeepLink: () => traceRendererIpc('cloud.claim-deep-link', () => cloudSource.claimDeepLink()),
  im: {
    overview: () => traceRendererIpc('cloud.im.overview', () => cloudSource.im.overview()),
    bindings: () => traceRendererIpc('cloud.im.bindings', () => cloudSource.im.bindings()),
    linkTelegram: (code) =>
      traceRendererIpc('cloud.im.link-telegram', () => cloudSource.im.linkTelegram(code)),
    unlinkTelegram: () =>
      traceRendererIpc('cloud.im.unlink-telegram', () => cloudSource.im.unlinkTelegram()),
    createBinding: (input) =>
      traceRendererIpc('cloud.im.create-binding', () => cloudSource.im.createBinding(input)),
    updateBinding: (sessionId, patch) =>
      traceRendererIpc('cloud.im.update-binding', () =>
        cloudSource.im.updateBinding(sessionId, patch),
      ),
    deleteBinding: (sessionId) =>
      traceRendererIpc('cloud.im.delete-binding', () => cloudSource.im.deleteBinding(sessionId)),
    preferences: () => traceRendererIpc('cloud.im.preferences', () => cloudSource.im.preferences()),
    setPreferences: (pref) =>
      traceRendererIpc('cloud.im.set-preferences', () => cloudSource.im.setPreferences(pref)),
  },
};

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
