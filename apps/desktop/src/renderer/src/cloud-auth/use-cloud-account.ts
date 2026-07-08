import type { CloudAccount } from '@linkcode/ui';
import { useState } from 'react';
import useSWR from 'swr';
import { useShallow } from 'zustand/react/shallow';
import { useCloudAuthStore } from './store';

/**
 * IdP account center. Profile and avatar are owned by the IdP (HQ forbids `/update-user`), so they're
 * edited in the browser where the user holds an IdP session. Same host in dev and prod — desktop dev
 * talks to the production cloud.
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
 * Footer view of the cloud account: the auth actions from the store plus a focus-driven avatar
 * refresh. The avatar URL is stable (`avatars.arcboxusercontent.com/u/{id}` never moves on change),
 * so a newly uploaded avatar stays invisible behind the browser's 5-min HTTP cache. SWR revalidates
 * `getUser()` on window focus — when the user returns from editing at the account center — folding any
 * name/email change back into the store and giving a throttled bust token to re-request the same URL.
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
