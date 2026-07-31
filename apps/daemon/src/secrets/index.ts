import { secretsFilePath } from '../paths';
import { loadMasterKey } from './keyring';
import type { SecretVault } from './vault';
import { createSecretVault } from './vault';

export type { SecretNamespace, SecretProtection, SecretStore, SecretVault } from './vault';

/**
 * Keyed by the resolved file so a changed `$HOME` (an E2E daemon, a test) yields a fresh vault,
 * while a normal run pays for the keyring round-trip once. Never memoized at module load: the
 * channel × profile universe is only known after the environment is in place (the CODE-166 class).
 */
const vaults = new Map<string, SecretVault>();

/**
 * The composition root's handle on the vault. Consumers take a {@link SecretVault} as a parameter and
 * open their own namespace rather than reaching this — which is what keeps each subsystem's key names
 * with the subsystem, and lets tests hand over an in-memory vault instead of mocking this module.
 */
export function secretVault(): SecretVault {
  const file = secretsFilePath();
  const existing = vaults.get(file);
  if (existing !== undefined) return existing;
  const vault = createSecretVault(file, loadMasterKey);
  vaults.set(file, vault);
  return vault;
}
