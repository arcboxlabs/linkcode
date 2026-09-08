import type { Accounts, ProvidersConfig } from '@linkcode/schema';
import type { SecretStore } from './vault';

/**
 * The secret/structure split for `config.json` (CODE-371). Provider API keys and account credentials
 * are the file's only secrets; everything else — ids, labels, endpoints, which account an agent is
 * bound to — is configuration worth keeping readable. So the secrets move to the vault and the file
 * keeps the rest, keyed by the id the record already carries.
 *
 * Reading merges the secret back in *before* zod validation, so an account whose secret is gone
 * simply fails `AccountSchema` and is dropped by the existing field-by-field handling — one code
 * path for "malformed" and "unrecoverable", both logged, neither able to blank the whole pool.
 */

/** A raw entry with its stored secret merged back in, and whether that secret was found inline. */
export interface AttachedSecret {
  value: unknown;
  /**
   * True when the secret was still in `config.json` — i.e. written before the vault existed. Reported
   * from the same pass that migrates it, so nothing has to re-walk the config to ask the question;
   * the caller rewrites the file once if any entry reports it.
   */
  migrated: boolean;
}

/** Attach the stored api key to one raw provider entry, migrating an inline one into the vault. */
export function withProviderSecret(store: SecretStore, kind: string, raw: unknown): AttachedSecret {
  if (typeof raw !== 'object' || raw === null) return { value: raw, migrated: false };
  const entry = { ...(raw as Record<string, unknown>) };

  const inline = entry.apiKey;
  if (typeof inline === 'string') {
    store.set(kind, inline);
    return { value: entry, migrated: true };
  }
  const stored = store.get(kind);
  if (stored !== null) entry.apiKey = stored;
  return { value: entry, migrated: false };
}

/** Attach the stored credential secret to one raw account, migrating an inline one into the vault. */
export function withAccountSecret(store: SecretStore, raw: unknown): AttachedSecret {
  if (typeof raw !== 'object' || raw === null) return { value: raw, migrated: false };
  const account = { ...(raw as Record<string, unknown>) };
  const { credential, id } = account;
  if (typeof id !== 'string' || typeof credential !== 'object' || credential === null) {
    return { value: raw, migrated: false };
  }

  const field = secretField(credential as Record<string, unknown>);
  if (field === null) return { value: raw, migrated: false };

  const next = { ...(credential as Record<string, unknown>) };
  const inline = next[field];
  if (typeof inline === 'string') {
    store.set(id, inline);
    account.credential = next;
    return { value: account, migrated: true };
  }
  const stored = store.get(id);
  if (stored === null) return { value: raw, migrated: false };
  next[field] = stored;
  account.credential = next;
  return { value: account, migrated: false };
}

/**
 * The on-disk form of `providers`: api keys handed to the vault in a **single** write, and any key
 * whose agent is no longer configured dropped along with them — `replaceAll` makes the prune implicit
 * and scoped, so this cannot reach another subsystem's secrets.
 */
export function detachProviderSecrets(
  store: SecretStore,
  providers: ProvidersConfig,
): ProvidersConfig {
  const stripped: ProvidersConfig = {};
  const secrets = new Map<string, string>();

  const providerEntries = Object.entries(providers);
  for (let i = 0, len = providerEntries.length; i < len; i++) {
    const [kind, config] = providerEntries[i];
    const { apiKey, ...rest } = config;
    if (apiKey !== undefined) secrets.set(kind, apiKey);
    Reflect.set(stripped, kind, rest);
  }
  store.replaceAll(secrets);
  return stripped;
}

/**
 * The on-disk form of the account pool, same contract: one write, and a deleted account's credential
 * goes with it rather than outliving the account in the OS keyring.
 */
export function detachAccountSecrets(store: SecretStore, accounts: Accounts): unknown[] {
  const secrets = new Map<string, string>();

  const stripped = accounts.map((account) => {
    const field = secretField(account.credential);
    if (field === null) return account;
    const { [field]: secret, ...credential } = account.credential as Record<string, unknown>;
    if (typeof secret === 'string') secrets.set(account.id, secret);
    return { ...account, credential };
  });
  store.replaceAll(secrets);
  return stripped;
}

/**
 * Which field of a credential holds the secret — `null` for `oauth`, which delegates to the agent
 * CLI's own login store and so has nothing for us to protect.
 */
function secretField(credential: Record<string, unknown>): 'key' | 'token' | null {
  if (credential.type === 'api-key') return 'key';
  if (credential.type === 'auth-token') return 'token';
  return null;
}
