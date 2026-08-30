import { disableDeviceNotifications } from '@mobile/runtime/notifications';
import { falseFn, noop, trueFn } from 'foxts/noop';
import { z } from 'zod';
import { CLOUD_URL, cloudAuthClient } from './client';
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

const freshSessionSchema = z.object({
  session: z.object({ id: z.string().min(1) }),
  user: z.object({ id: z.string().min(1) }),
});

export class CloudAccountMismatchError extends Error {
  override name = 'CloudAccountMismatchError';
}

async function readAuthoritativeSession(): Promise<{ sessionId: string; userId: string }> {
  const { data, error } = await cloudAuthClient.$fetch<unknown>(
    `${CLOUD_URL}/auth/get-session?disableCookieCache=true`,
    {},
  );
  if (error) throw new Error(`session read failed (${error.status})`);
  const { session, user } = freshSessionSchema.parse(data);
  return { sessionId: session.id, userId: user.id };
}

export async function reauthenticateToCloud(): Promise<void> {
  const previous = await readAuthoritativeSession();
  await signInToCloud();
  const current = await readAuthoritativeSession();
  if (current.sessionId === previous.sessionId) {
    throw new Error('browser re-authentication did not create a fresh session');
  }
  if (current.userId !== previous.userId) {
    await cloudAuthClient.signOut().catch(noop);
    throw new CloudAccountMismatchError('browser re-authentication signed in a different account');
  }
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
