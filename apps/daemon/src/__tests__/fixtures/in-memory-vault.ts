import type { SecretProtection, SecretStore, SecretVault } from '../../secrets';

export interface InMemoryVault extends SecretVault {
  /** Every stored secret by its full `namespace:key` ref — what a test asserts against. */
  readonly refs: Map<string, string>;
}

/**
 * A vault that keeps everything in a Map, for testing the modules that consume one.
 *
 * They take a {@link SecretVault} as a parameter, so a test hands this over instead of mocking the
 * secrets module — which is also why the real namespace prefixing is exercised here rather than
 * stubbed: `refs` holds the same `namespace:key` strings the on-disk store would.
 */
export function createInMemoryVault(protection: SecretProtection = 'os-keyring'): InMemoryVault {
  const refs = new Map<string, string>();

  const namespace = (name: string): SecretStore => {
    const prefix = `${name}:`;
    return {
      protection,
      get: (key) => refs.get(prefix + key) ?? null,
      keys: () => {
        const keys: string[] = [];
        for (const ref of refs.keys()) {
          if (ref.startsWith(prefix)) keys.push(ref.slice(prefix.length));
        }
        return keys;
      },
      set(key, secret) {
        refs.set(prefix + key, secret);
      },
      delete(key) {
        refs.delete(prefix + key);
      },
      replaceAll(entries) {
        for (const ref of refs.keys()) {
          if (ref.startsWith(prefix)) refs.delete(ref);
        }
        for (const [key, secret] of entries) refs.set(prefix + key, secret);
      },
    };
  };

  return { protection, namespace, refs };
}
