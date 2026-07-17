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
 * reshaped into an explicit three-state view (better-auth owns the session).
 */
export function useCloudAccount(): CloudAccount {
  const { data, isPending } = cloudAuthClient.useSession();
  if (isPending) return { status: 'loading' };
  if (!data) return { status: 'signed-out' };
  return { status: 'signed-in', user: data.user };
}

export async function signInToCloud(): Promise<void> {
  // Generic OAuth rides signIn.social as of better-auth 1.7. Failures come back as
  // a value, not a rejection — rethrow (a dismissed browser resolves without error).
  const { error } = await cloudAuthClient.signIn.social({
    provider: IDP_PROVIDER_ID,
    callbackURL: '/connect',
  });
  if (error) throw new Error(`sign-in failed (${error.status})`);
}

export async function signOutOfCloud(): Promise<void> {
  await cloudAuthClient.signOut();
  // Forget the enrollment so a different account signing in on this phone
  // registers the device under itself instead of silently skipping.
  await clearDeviceEnrollment().catch(noop);
}
