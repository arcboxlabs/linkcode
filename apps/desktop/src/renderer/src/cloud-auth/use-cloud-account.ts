import type { CloudAccount } from '@linkcode/ui';
import { useState } from 'react';
import useSWR from 'swr';
import { useShallow } from 'zustand/react/shallow';
import { useCloudAuthStore } from './store';

/**
 * IdP account center. Profile and avatar are owned by the IdP (HQ forbids `/update-user`), so
 * they're edited in the browser; same host in dev and prod (desktop dev talks to production cloud).
 */
const ACCOUNT_CENTER_URL = 'https://auth.arcbox.dev/account';

/** Opens the IdP account center in the system browser (window.open → shell.openExternal). */
function openAccountCenter(): void {
  window.open(ACCOUNT_CENTER_URL, '_blank');
}

export interface CloudAccountView {
  account: CloudAccount | null;
  authenticating: boolean;
  signIn: () => void;
  signOut: () => void;
  /** Opens the IdP account center in the system browser (window.open → shell.openExternal). */
  manageAccount: () => void;
}

/**
 * Footer view of the cloud account: the store's auth actions plus a focus-driven avatar refresh.
 * The avatar URL never changes, so a new upload hides behind the browser's 5-min HTTP cache — SWR
 * revalidates `getUser()` on window focus, folding name/email changes back into the store and
 * issuing a throttled bust token to re-request the same URL.
 */
export function useCloudAccount(): CloudAccountView {
  const { user, authenticating, signIn, signOut } = useCloudAuthStore(
    useShallow((state) => ({
      user: state.user,
      authenticating: state.authenticating,
      signIn: state.signIn,
      signOut: state.signOut,
    })),
  );

  const [avatarBust, setAvatarBust] = useState(0);
  useSWR('cloud-auth/user', () => window.getUser(), {
    revalidateOnFocus: true,
    onSuccess(fresh) {
      useCloudAuthStore.setState({ user: fresh ?? null });
      setAvatarBust(Date.now());
    },
  });

  const account: CloudAccount | null = user
    ? { name: user.name, email: user.email, image: bustAvatar(user.image, avatarBust) }
    : null;

  return { account, authenticating, signIn, signOut, manageAccount: openAccountCenter };
}

/** Appends a focus-scoped cache-bust token to the stable avatar URL so a new avatar re-renders. */
function bustAvatar(image: string | null | undefined, token: number): string | null {
  if (!image || !token) return image ?? null;
  const url = new URL(image);
  url.searchParams.set('_', String(token));
  return url.href;
}
