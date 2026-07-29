import type { Accounts, ProvidersConfig } from '@linkcode/schema';
import { logger } from '../logger';
import { accountSecretRef, providerApiKeyRef, secretVault } from '.';

/**
 * The secret/structure split for `config.json` (CODE-371). Provider API keys and account credentials
 * are the file's only secrets; everything else — ids, labels, endpoints, which account an agent is
 * bound to — is configuration worth keeping readable. So the secrets move to the vault and the file
 * keeps the rest, with the vault ref derived from the id the record already carries.
 *
 * Reading merges the secret back in *before* zod validation, so an account whose secret is gone
 * simply fails `AccountSchema` and is dropped by the existing field-by-field handling — one code
 * path for "malformed" and "unrecoverable", both logged, neither able to blank the whole pool.
 */

/** Attach the stored api key to one raw provider entry, migrating an inline one into the vault. */
export function withProviderSecret(kind: string, raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const entry = { ...(raw as Record<string, unknown>) };
  const ref = providerApiKeyRef(kind);

  if (typeof entry.apiKey === 'string') {
    secretVault().set(ref, entry.apiKey);
    return entry;
  }
  const stored = secretVault().get(ref);
  if (stored !== null) entry.apiKey = stored;
  return entry;
}

/** Attach the stored credential secret to one raw account, migrating an inline one into the vault. */
export function withAccountSecret(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const account = { ...(raw as Record<string, unknown>) };
  const { credential, id } = account;
  if (typeof id !== 'string' || typeof credential !== 'object' || credential === null) return raw;

  const field = secretField(credential as Record<string, unknown>);
  if (field === null) return raw;

  const next = { ...(credential as Record<string, unknown>) };
  const ref = accountSecretRef(id);
  const inline = next[field];
  if (typeof inline === 'string') {
    secretVault().set(ref, inline);
  } else {
    const stored = secretVault().get(ref);
    if (stored === null) return raw;
    next[field] = stored;
  }
  account.credential = next;
  return account;
}

/** True when the raw config still carries a secret inline — i.e. it predates the vault. */
export function hasInlineSecrets(providers: unknown, accounts: unknown): boolean {
  const providerEntries =
    typeof providers === 'object' && providers !== null ? Object.values(providers) : [];
  if (providerEntries.some((entry) => typeof readField(entry, 'apiKey') === 'string')) return true;

  if (!Array.isArray(accounts)) return false;
  return accounts.some((entry) => {
    const credential = readField(entry, 'credential');
    if (typeof credential !== 'object' || credential === null) return false;
    const field = secretField(credential as Record<string, unknown>);
    return field !== null && typeof readField(credential, field) === 'string';
  });
}

function readField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return Reflect.get(value, key);
}

/** The on-disk form of `providers`: api keys moved to the vault, refs of removed agents pruned. */
export function detachProviderSecrets(providers: ProvidersConfig): ProvidersConfig {
  const vault = secretVault();
  const stripped: ProvidersConfig = {};
  const live = new Set<string>();

  for (const [kind, config] of Object.entries(providers)) {
    const { apiKey, ...rest } = config;
    if (apiKey !== undefined) {
      const ref = providerApiKeyRef(kind);
      vault.set(ref, apiKey);
      live.add(ref);
    }
    Reflect.set(stripped, kind, rest);
  }
  pruneOrphans(vault, 'provider:', live);
  return stripped;
}

/** The on-disk form of the account pool: credential secrets moved to the vault, deleted ones pruned. */
export function detachAccountSecrets(accounts: Accounts): unknown[] {
  const vault = secretVault();
  const live = new Set<string>();

  const stripped = accounts.map((account) => {
    const field = secretField(account.credential);
    if (field === null) return account;
    const ref = accountSecretRef(account.id);
    const { [field]: secret, ...credential } = account.credential as Record<string, unknown>;
    if (typeof secret === 'string') {
      vault.set(ref, secret);
      live.add(ref);
    }
    return { ...account, credential };
  });
  pruneOrphans(vault, 'account:', live);
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

/** Drop refs whose owning record is gone, so deleting an account deletes its credential too. */
function pruneOrphans(
  vault: ReturnType<typeof secretVault>,
  prefix: string,
  live: ReadonlySet<string>,
): void {
  for (const ref of vault.list(prefix)) {
    if (live.has(ref)) continue;
    vault.delete(ref);
    logger.info({ operation: 'secrets.prune', ref }, 'Dropped a stored secret with no owner');
  }
}
