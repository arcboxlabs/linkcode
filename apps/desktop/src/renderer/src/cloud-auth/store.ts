import { syncProductAnalyticsIdentity } from '@linkcode/workbench';
import { create } from 'zustand';
import { traceRendererIpc } from '../ipc';
import type { CloudUser } from './bridges';
import { cloudDataBridge } from './bridges';

interface CloudAuthState {
  /** The signed-in LinkCode Cloud user, or null when signed out / not yet loaded. */
  user: CloudUser | null;
  /** True after a bridge event or the initial getUser request resolves. */
  loaded: boolean;
  /** True only while the sign-in request is handing off to the system browser. */
  authenticating: boolean;
  publishUser: (user: CloudUser | null) => void;
  signIn: () => void;
  signOut: () => void;
}

/**
 * Renderer-side view of the cloud auth session — the main process owns the real one. Synced via
 * the plugin's `onAuthenticated`/`onUserUpdated`/`onAuthError` bridges, wired once at store
 * creation (never a `useEffect` watcher); the initial seed and focus refresh of `user` come from
 * the `getUser()` SWR resource in `useCloudAccount`.
 */
export const useCloudAuthStore = create<CloudAuthState>((set, get) => {
  const publishUser = (user: CloudUser | null): void => {
    const current = get();
    if (!current.loaded || current.user?.id !== user?.id) {
      syncProductAnalyticsIdentity(user?.id ?? null);
    }
    set({ user, loaded: true });
  };

  window.onAuthenticated((user) => {
    publishUser(user);
    set({ authenticating: false });
  });
  window.onUserUpdated((user) => publishUser(user ?? null));
  window.onAuthError(() => set({ authenticating: false }));

  return {
    user: null,
    loaded: false,
    authenticating: false,
    publishUser,
    signIn() {
      set({ authenticating: true });
      void Promise.allSettled([cloudDataBridge.claimDeepLink()])
        .then(() => traceRendererIpc('cloud.auth.request', () => window.requestAuth()))
        .finally(() => set({ authenticating: false }));
    },
    signOut() {
      void traceRendererIpc('cloud.auth.sign-out', () => window.signOut());
      publishUser(null);
    },
  };
});
