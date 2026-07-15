import { noop } from 'foxact/noop';
import { cloudAuthClient } from './client';
import { clearDeviceEnrollment } from './devices';

/** The cloud's genericOAuth provider id — the central IdP is the only sign-in path. */
const IDP_PROVIDER_ID = 'central-idp';

export interface CloudUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
}

export type CloudAccount =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; user: CloudUser };

/**
 * The one account read for every screen: better-auth's reactive session
 * folded into an explicit three-state view. Better-auth owns the session —
 * this only reshapes it, so all screens re-render together on auth changes.
 */
export function useCloudAccount(): CloudAccount {
  const { data, isPending } = cloudAuthClient.useSession();
  if (isPending) return { status: 'loading' };
  if (!data) return { status: 'signed-out' };
  return { status: 'signed-in', user: data.user };
}

export function signInToCloud(): Promise<unknown> {
  // Generic OAuth shares the social sign-in flow as of better-auth 1.7. The
  // system browser runs the IdP flow; the deep link lands back on /connect.
  return cloudAuthClient.signIn.social({ provider: IDP_PROVIDER_ID, callbackURL: '/connect' });
}

export async function signOutOfCloud(): Promise<void> {
  await cloudAuthClient.signOut();
  // Forget the enrollment so a different account signing in on this phone
  // registers the device under itself instead of silently skipping.
  await clearDeviceEnrollment().catch(noop);
}
