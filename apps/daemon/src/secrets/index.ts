import { secretsFilePath } from '../paths';
import { loadMasterKey } from './keyring';
import type { SecretVault } from './vault';
import { createSecretVault } from './vault';

export type { SecretProtection, SecretVault } from './vault';

/**
 * Stable vault refs. Derivable from what the caller already holds — an account id, an agent kind —
 * so no file needs to store a pointer alongside the structure it describes.
 */
export const HQ_SESSION_REF = 'hq:session';
export const DEVICE_SOFTWARE_KEY_REF = 'device:software-key';
export const accountSecretRef = (accountId: string): string => `account:${accountId}`;
export const providerApiKeyRef = (agentKind: string): string => `provider:${agentKind}`;

/**
 * Keyed by the resolved file so a changed `$HOME` (an E2E daemon, a test) yields a fresh vault,
 * while a normal run pays for the keyring round-trip once. Never memoized at module load: the
 * channel × profile universe is only known after the environment is in place (the CODE-166 class).
 */
const vaults = new Map<string, SecretVault>();

export function secretVault(): SecretVault {
  const file = secretsFilePath();
  const existing = vaults.get(file);
  if (existing !== undefined) return existing;
  const vault = createSecretVault(file, loadMasterKey());
  vaults.set(file, vault);
  return vault;
}
