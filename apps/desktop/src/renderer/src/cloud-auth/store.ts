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
 * Renderer-side view of the cloud auth session. The main process owns the actual session (keychain,
 * browser flow, deep-link callback); this store stays in sync via the plugin's `onAuthenticated` /
 * `onUserUpdated` / `onAuthError` bridges — never a `useEffect` watcher. The subscriptions are wired
 * once when the store is created; the initial seed and focus refresh of `user` come from the
 * `getUser()` SWR resource in `useCloudAccount`.
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
      // requestAuth resolves once the system browser has been handed the sign-in URL; the
      // rest of the flow happens out-of-app (deep link → onAuthenticated). Clear the flag on
      // that handoff — otherwise abandoning the browser leaves no callback to fire and the
      // button stays disabled until reload.
      void window.requestAuth().finally(() => set({ authenticating: false }));
    },
    signOut() {
      void window.signOut();
      set({ user: null });
    },
  };
});
