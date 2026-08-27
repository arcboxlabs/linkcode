import { disableDeviceNotifications } from '@mobile/runtime/notifications';
import { falseFn, noop, trueFn } from 'foxts/noop';
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

export async function signOutOfCloud(options: { revokePushToken?: boolean } = {}): Promise<void> {
  let pushDeliveryDisabled = false;
  let signedOut = false;
  try {
    pushDeliveryDisabled = await disableDeviceNotifications({
      revokeToken: options.revokePushToken,
      rollbackOnFailure: false,
    })
      .then(trueFn)
      .catch(falseFn);
    const { error } = await cloudAuthClient.signOut();
    if (error) throw new Error(`sign-out failed (${error.status})`);
    signedOut = true;
  } finally {
    // Retain enrollment whenever a still-live device binding may need recovery after sign-out.
    const deviceAlreadyRevoked = options.revokePushToken === false;
    if (pushDeliveryDisabled && (signedOut || deviceAlreadyRevoked)) {
      await clearDeviceEnrollment().catch(noop);
    }
  }
}
