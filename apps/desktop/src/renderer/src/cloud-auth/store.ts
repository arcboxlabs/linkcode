import { create } from 'zustand';
import type { CloudUser } from './bridges';

interface CloudAuthState {
  /** The signed-in LinkCode Cloud user, or null when signed out / not yet loaded. */
  user: CloudUser | null;
  /** True only while the sign-in request is handing off to the system browser. */
  authenticating: boolean;
  signIn: () => void;
  signOut: () => void;
}

/**
 * Renderer-side view of the cloud auth session — the main process owns the real one. Synced via
 * the plugin's `onAuthenticated`/`onUserUpdated`/`onAuthError` bridges, wired once at store
 * creation (never a `useEffect` watcher); the initial seed and focus refresh of `user` come from
 * the `getUser()` SWR resource in `useCloudAccount`.
 */
export const useCloudAuthStore = create<CloudAuthState>((set) => {
  window.onAuthenticated((user) => set({ user, authenticating: false }));
  window.onUserUpdated((user) => set({ user: user ?? null }));
  window.onAuthError(() => set({ authenticating: false }));

  return {
    user: null,
    authenticating: false,
    signIn() {
      set({ authenticating: true });
      // Re-assert the deep-link scheme before the browser handoff so the OAuth callback routes
      // back to THIS app; `allSettled` lets a failed re-assert still proceed to sign-in.
      // requestAuth resolves once the system browser has the sign-in URL — clear the flag on that
      // handoff, otherwise abandoning the browser leaves no callback and the button stays disabled.
      void Promise.allSettled([window.linkcodeCloud.claimDeepLink()])
        .then(() => window.requestAuth())
        .finally(() => set({ authenticating: false }));
    },
    signOut() {
      void window.signOut();
      set({ user: null });
    },
  };
});
