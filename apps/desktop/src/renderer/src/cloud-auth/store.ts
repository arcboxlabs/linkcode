import { create } from 'zustand';
import type { CloudUser } from './bridges';

interface CloudAuthState {
  /** The signed-in LinkCode Cloud user, or null when signed out / not yet loaded. */
  user: CloudUser | null;
  /** True from the moment sign-in is requested until the browser callback resolves or errors. */
  authenticating: boolean;
  signIn: () => void;
  signOut: () => void;
}

/**
 * Renderer-side view of the cloud auth session. The main process owns the actual session (keychain,
 * browser flow, deep-link callback); this store seeds from `window.getUser()` on boot and stays in
 * sync via the plugin's `onAuthenticated` / `onUserUpdated` / `onAuthError` bridges — never a
 * `useEffect` watcher. The subscriptions are wired once when the store is created.
 */
export const useCloudAuthStore = create<CloudAuthState>((set) => {
  void window.getUser().then((user) => set({ user: user ?? null }));
  window.onAuthenticated((user) => set({ user, authenticating: false }));
  window.onUserUpdated((user) => set({ user: user ?? null }));
  window.onAuthError(() => set({ authenticating: false }));

  return {
    user: null,
    authenticating: false,
    signIn() {
      set({ authenticating: true });
      void window.requestAuth();
    },
    signOut() {
      void window.signOut();
      set({ user: null });
    },
  };
});
