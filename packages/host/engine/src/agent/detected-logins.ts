import { detectedLogins } from '@linkcode/providers';
import type { Account, AgentRuntimes } from '@linkcode/schema';
import { Clock, Effect } from 'effect';
import { OperationError } from '../failure';
import type { ProviderConfigStore } from './provider-config';

/**
 * Adopt every probed CLI login the pool does not represent yet. A delegated subscription is an
 * account like any other — same picker, same resolution at session start — so detection alone is
 * enough to create it; leaving it to an explicit import meant a signed-in agent had no account, and
 * therefore nothing pickable, until the user visited Settings.
 *
 * Only the pool grows. Nothing is bound and no model is picked, so no session changes what it runs
 * on, and a user who deletes the account gets it back on the next probe — which is correct: the CLI
 * login is still there, and the pool describes what exists.
 */
export function adoptDetectedLogins(
  providers: ProviderConfigStore,
  runtimes: AgentRuntimes,
): Effect.Effect<void, OperationError> {
  return Clock.currentTimeMillis.pipe(
    Effect.flatMap((createdAt) =>
      Effect.tryPromise({
        // The pool is read inside the write path so a concurrent `config.set` cannot land between
        // the two and lose either side's accounts.
        async try() {
          const accounts = providers.getAccounts();
          const adopted = detectedLogins(accounts, runtimes).map(
            ({ service }): Account => ({
              id: `acc_${crypto.randomUUID()}`,
              label: service.label,
              service: service.id,
              credential: { type: 'oauth', agent: service.agent },
              createdAt,
            }),
          );
          if (adopted.length === 0) return [];
          await providers.update({ accounts: [...accounts, ...adopted] });
          return adopted;
        },
        catch: (cause) =>
          new OperationError({
            subsystem: 'store',
            operation: 'config.adopt-detected-logins',
            publicMessage: 'Failed to adopt detected agent logins',
            cause,
          }),
      }),
    ),
    Effect.flatMap((adopted) =>
      adopted.length === 0
        ? Effect.void
        : Effect.logInfo('Adopted detected agent CLI logins', {
            operation: 'config.adopt-detected-logins',
            services: adopted.map((account) => account.service),
          }),
    ),
  );
}
