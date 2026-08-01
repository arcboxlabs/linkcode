import type { CustomMcpServer } from '@linkcode/schema';
import type { AttachedSecret } from './provider-credentials';
import type { SecretStore } from './vault';

function secretKey(
  generation: number | undefined,
  id: string,
  field: 'env' | 'headers',
  key: string,
): string {
  return JSON.stringify(generation === undefined ? [id, field, key] : [generation, id, field, key]);
}

export function withCustomMcpSecrets(
  store: SecretStore,
  raw: unknown,
  generation?: number,
): AttachedSecret {
  if (typeof raw !== 'object' || raw === null) return { value: raw, migrated: false };
  const entry = { ...(raw as Record<string, unknown>) };
  if (typeof entry.id !== 'string' || typeof entry.server !== 'object' || entry.server === null) {
    return { value: raw, migrated: false };
  }
  const server = { ...(entry.server as Record<string, unknown>) };
  const field = server.type === 'stdio' ? 'env' : server.type === 'http' ? 'headers' : null;
  if (field === null || typeof server[field] !== 'object' || server[field] === null) {
    return { value: raw, migrated: false };
  }
  const values = { ...(server[field] as Record<string, unknown>) };
  let migrated = false;
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') {
      store.set(secretKey(generation, entry.id, field, key), value);
      migrated = true;
    } else {
      const stored = store.get(secretKey(generation, entry.id, field, key));
      if (stored !== null) values[key] = stored;
    }
  }
  server[field] = values;
  entry.server = server;
  return { value: entry, migrated };
}

export function detachCustomMcpSecrets(
  servers: CustomMcpServer[],
  generation?: number,
): { servers: unknown[]; secrets: Map<string, string> } {
  const secrets = new Map<string, string>();
  const stripped = servers.map((entry) => {
    const field = entry.server.type === 'stdio' ? 'env' : 'headers';
    const values = entry.server.type === 'stdio' ? entry.server.env : entry.server.headers;
    if (values === undefined) return entry;
    const placeholders: Record<string, null> = {};
    for (const [key, value] of Object.entries(values)) {
      secrets.set(secretKey(generation, entry.id, field, key), value);
      placeholders[key] = null;
    }
    return { ...entry, server: { ...entry.server, [field]: placeholders } };
  });
  return { servers: stripped, secrets };
}
