import { useHostRegistryStore } from '@mobile/stores/host-store';
import * as Sentry from '@sentry/react-native';
import { z } from 'zod';
import { signInToCloud } from './account';
import { CLOUD_URL, cloudAuthClient } from './client';
import { clearDeviceEnrollment } from './devices';
import { reauthenticateWithApple, signOutOfIdp } from './idp';

/**
 * CODE-292: permanent, in-app account deletion. `deleteAccount` is the whole
 * flow — reauthentication, the single `DELETE /account` request, and local
 * teardown; `runAccountDeletionTeardown` is exported separately only so a
 * retry (best-effort, on next launch/foreground) can re-run just that part.
 */

export type AccountDeletionRevocation = 'completed' | 'failed' | 'not_applicable';

export type AccountDeletionOutcome =
  | { kind: 'completed'; authorizationRevocation: AccountDeletionRevocation }
  | { kind: 'pending'; reference?: string }
  /** Reauthentication itself failed (wrong account, cancelled, expired) — the
   * account is untouched; PONR was never reached. */
  | { kind: 'reauthentication-failed' }
  /** The delete request failed before any state changed (network error, or
   * a 409 pre-check) — the account is untouched. `code` is the server's biz
   * code when available (e.g. `ACCOUNT_DELETION_SOLE_ORGANIZATION_OWNER`),
   * for copy that names the specific reason. */
  | { kind: 'failed'; code?: string };

const deletionResponseSchema = z.object({
  status: z.enum(['completed', 'pending']),
  authorizationRevocation: z.enum(['completed', 'failed', 'not_applicable']).optional(),
  reference: z.string().optional(),
});

/**
 * Re-authenticates and submits the single delete request. `isAppleAvailable`
 * mirrors the sign-in screen's own capability check
 * (`AppleAuthentication.isAvailableAsync()`) — mobile has no local signal for
 * *which* provider a given central identity actually uses (D-19's accepted
 * gap), so, like the sign-in screen, this branches on device capability, not
 * account provider.
 */
export async function deleteAccount(options: {
  isAppleAvailable: boolean;
}): Promise<AccountDeletionOutcome> {
  let idpToken: string | undefined;
  let appleAuthorizationCode: string | undefined;

  try {
    if (options.isAppleAvailable) {
      const reauth = await reauthenticateWithApple();
      idpToken = reauth.idpToken;
      appleAuthorizationCode = reauth.authorizationCode;
    } else {
      // No local proof to mint for this branch (D-19's accepted gap) — the
      // request below instead relies on the server's session-freshness
      // check, so re-running the existing browser sign-in flow (which mints
      // a fresh session) *is* this branch's re-authentication.
      await signInToCloud();
    }
  } catch {
    return { kind: 'reauthentication-failed' };
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
  } catch {
    // No response ever arrived — never report acceptance on a guess (D-23,
    // reversing the original §3.4 "treat as pending" call). Retrying is
    // always safe: the server's deletion CAS is idempotent, so if this
    // request actually landed, retrying just observes `completed` without
    // repeating any side effect.
    return { kind: 'failed' };
  }

  if (response.error) {
    if (response.error.status === 401) return { kind: 'reauthentication-failed' };
    // Any other status (409 pre-check, or a pre-PONR 500): the design's
    // contract is that only a pre-PONR failure returns an error status at
    // all, so the account is untouched either way.
    return {
      kind: 'failed',
      code: typeof response.error.code === 'string' ? response.error.code : undefined,
    };
  }

  const parsed = deletionResponseSchema.safeParse(response.data);
  if (!parsed.success) {
    // The server accepted the request but the response shape is unreadable —
    // ambiguous in the same way a network failure is: assume accepted.
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
  for (const result of results) {
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

/** Removes every tunnel-derived host profile — account-scoped, so it can't
 * outlive the account (design.md §3.5). Direct/LAN profiles, which name a
 * URL rather than an account-issued host id, are left alone. Selected-host
 * fallback and connection disposal are already handled by existing reactive
 * code (`useSelectedHost`, `HostConnectionScope`) once these rows disappear —
 * this function must not re-implement either. */
function removeTunnelHosts(): void {
  const { hosts, removeHost } = useHostRegistryStore.getState();
  for (const host of hosts) {
    if ('tunnelHostId' in host) removeHost(host.id);
  }
}
