import { useHostRegistryStore } from '@mobile/stores/host-store';
import * as Sentry from '@sentry/react-native';
import { z } from 'zod';
import { CloudAccountMismatchError, reauthenticateToCloud } from './account';
import { CLOUD_URL, cloudAuthClient } from './client';
import { clearDeviceEnrollment } from './devices';
import {
  IdpTokenAcquisitionError,
  isAppleAuthenticationAvailable,
  isAppleSignInCancel,
  reauthenticateWithApple,
  signOutOfIdp,
} from './idp';

export type AccountDeletionRevocation = 'completed' | 'failed' | 'not_applicable';

export type AccountDeletionOutcome =
  | { kind: 'completed'; authorizationRevocation: AccountDeletionRevocation }
  | { kind: 'pending'; reference?: string }
  /** Reauthentication itself failed (wrong account, cancelled, expired) — the
   * account is untouched; PONR was never reached. */
  | { kind: 'reauthentication-failed' }
  /** The server requires Apple re-authentication, which this device cannot perform. */
  | { kind: 'apple-device-required' }
  /** Browser re-authentication signed in a different Cloud account. */
  | { kind: 'account-mismatch' }
  /** No HTTP response arrived, so the client cannot know whether deletion crossed PONR. */
  | { kind: 'unknown' }
  /** The server rejected the request before any state changed. `code` is the server's biz
   * code when available (e.g. `ACCOUNT_DELETION_SOLE_ORGANIZATION_OWNER`),
   * for copy that names the specific reason. */
  | { kind: 'failed'; code?: string };

const deletionResponseSchema = z.object({
  status: z.enum(['completed', 'pending']),
  authorizationRevocation: z.enum(['completed', 'failed', 'not_applicable']).optional(),
  reference: z.string().optional(),
});

const deletionRequirementsSchema = z.object({
  method: z.enum(['native', 'browser']),
});

type AccountDeletionFailureStage =
  | 'requirements'
  | 'native-provider'
  | 'idp-token'
  | 'browser-sign-in'
  | 'cloud-identity'
  | 'response'
  | 'transport';

function reportFailure(stage: AccountDeletionFailureStage, error: unknown): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console -- local acceptance has no Sentry DSN
    console.error('Account deletion failed', { stage, error });
  }
  Sentry.captureException(error, { tags: { account_deletion_stage: stage } });
}

/**
 * Reads the server-owned re-authentication requirement, re-authenticates, and
 * submits one delete mutation. Device capability is not an account fact.
 */
export async function deleteAccount(): Promise<AccountDeletionOutcome> {
  let idpToken: string | undefined;
  let appleAuthorizationCode: string | undefined;

  let method: 'native' | 'browser';
  try {
    const requirements = await cloudAuthClient.$fetch<unknown>(
      `${CLOUD_URL}/account/deletion-requirements`,
      {},
    );
    if (requirements.error) {
      throw new Error(`deletion requirements failed (${requirements.error.status})`);
    }
    method = deletionRequirementsSchema.parse(requirements.data).method;
  } catch (error) {
    reportFailure('requirements', error);
    return { kind: 'failed' };
  }

  if (method === 'native') {
    try {
      if (!(await isAppleAuthenticationAvailable())) {
        return { kind: 'apple-device-required' };
      }
      const reauth = await reauthenticateWithApple();
      idpToken = reauth.idpToken;
      appleAuthorizationCode = reauth.authorizationCode;
    } catch (error) {
      if (!isAppleSignInCancel(error)) {
        reportFailure(
          error instanceof IdpTokenAcquisitionError ? 'idp-token' : 'native-provider',
          error,
        );
      }
      return { kind: 'reauthentication-failed' };
    }
  } else {
    try {
      // Browser re-authentication relies on the server's session-freshness check.
      await reauthenticateToCloud();
    } catch (error) {
      if (error instanceof CloudAccountMismatchError) {
        return { kind: 'account-mismatch' };
      }
      reportFailure('browser-sign-in', error);
      return { kind: 'reauthentication-failed' };
    }
  }

  let response: {
    data: unknown;
    error: { status: number; code?: unknown } | null;
  };
  try {
    response = await cloudAuthClient.$fetch<unknown>(`${CLOUD_URL}/account`, {
      method: 'DELETE',
      body: { idpToken, appleAuthorizationCode },
    });
  } catch (error) {
    reportFailure('transport', error);
    return { kind: 'unknown' };
  }

  if (response.error) {
    if (response.error.status === 401) {
      reportFailure('cloud-identity', new Error('Cloud rejected account re-authentication'));
      return { kind: 'reauthentication-failed' };
    }
    if (response.error.status !== 409) {
      reportFailure('response', new Error(`account deletion failed (${response.error.status})`));
    }
    return {
      kind: 'failed',
      code: typeof response.error.code === 'string' ? response.error.code : undefined,
    };
  }

  const parsed = deletionResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    reportFailure('response', parsed.error);
    // A successful HTTP response proves acceptance even when its body is unreadable.
    return { kind: 'pending' };
  }
  if (parsed.data.status === 'pending') {
    return { kind: 'pending', reference: parsed.data.reference };
  }
  return {
    kind: 'completed',
    authorizationRevocation: parsed.data.authorizationRevocation ?? 'not_applicable',
  };
}

/**
 * Best-effort local cleanup once deletion has been accepted (`completed` or
 * `pending` — never call this for `reauthentication-failed` or `failed`,
 * where the account is still active). Every step is independent; one
 * failing must never look like "deletion failed" to the caller, since the
 * server has already committed to it. Safe to call again — every step is
 * idempotent on an already-clean state.
 */
export async function runAccountDeletionTeardown(): Promise<void> {
  const results = await Promise.allSettled([
    cloudAuthClient.signOut(),
    signOutOfIdp(),
    clearDeviceEnrollment(),
  ]);
  for (let index = 0, length = results.length; index < length; index += 1) {
    const result = results[index];
    if (result.status === 'rejected') {
      Sentry.captureException(result.reason);
    }
  }
  try {
    removeTunnelHosts();
  } catch (error) {
    Sentry.captureException(error);
  }
}

/** Removes account-scoped tunnel profiles. Reactive consumers handle connection disposal. */
function removeTunnelHosts(): void {
  const { hosts, removeHost } = useHostRegistryStore.getState();
  for (let index = 0, length = hosts.length; index < length; index += 1) {
    const host = hosts[index];
    if ('tunnelHostId' in host) removeHost(host.id);
  }
}
