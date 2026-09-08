import type {
  CustomMcpServer,
  CustomMcpServerPatchOp,
  CustomMcpServerPublic,
  McpSecretPatch,
  McpServer,
  McpServerPublic,
  McpServerUpdate,
} from '@linkcode/schema';
import { Effect } from 'effect';
import { never } from 'foxts/guard';
import { isObjectEmpty } from 'foxts/is-object-empty';
import { OperationError, RequestError } from '../failure';
import { SIMULATOR_MCP_SERVER_NAME } from '../session/mcp-capability';
import type { ProviderConfigStore } from './provider-config';

/** Names the daemon injects itself (simulator endpoint, claude browser tools); a custom server
 * must never claim one or the session-start merge would silently shadow a built-in. */
export const RESERVED_MCP_SERVER_NAMES: ReadonlySet<string> = new Set([
  SIMULATOR_MCP_SERVER_NAME,
  'linkcode_browser',
]);

/**
 * The LinkCode-owned ("bring your own") MCP server config plane: masked reads, patch-op writes.
 * Secrets live only in the store; the public projection carries key lists, never values, which is
 * why writes are patches — a client holding the masked view could not legally resend full servers.
 */
export class CustomMcpServerService {
  constructor(private readonly store: ProviderConfigStore) {}

  list(): CustomMcpServer[] {
    return this.store.getCustomMcpServers();
  }

  listEnabled(): CustomMcpServer[] {
    return this.list().filter((entry) => entry.enabled);
  }

  listPublic(): CustomMcpServerPublic[] {
    return this.list().map((entry) => maskCustomMcpServer(entry));
  }

  applyPatch(ops: CustomMcpServerPatchOp[]): Effect.Effect<void, RequestError | OperationError> {
    return Effect.suspend((): Effect.Effect<void, RequestError | OperationError> => {
      let next = [...this.store.getCustomMcpServers()];
      for (let i = 0, len = ops.length; i < len; i++) {
        const op = ops[i];
        switch (op.op) {
          case 'add': {
            if (next.some((entry) => entry.id === op.server.id)) {
              return Effect.fail(
                new RequestError({
                  code: 'conflict',
                  message: `Duplicate custom MCP server id: ${op.server.id}`,
                }),
              );
            }
            const conflict = validateName(op.server.server.name, next, undefined);
            if (conflict) return Effect.fail(conflict);
            next.push(op.server);
            break;
          }
          case 'update': {
            const index = next.findIndex((entry) => entry.id === op.id);
            if (index < 0) {
              return Effect.fail(
                new RequestError({
                  code: 'not_found',
                  message: `Unknown custom MCP server: ${op.id}`,
                }),
              );
            }
            const current = next[index];
            let server = current.server;
            if (op.server) {
              const updated = applyServerUpdate(current.server, op.server, next, op.id);
              if (updated instanceof RequestError) return Effect.fail(updated);
              server = updated;
            }
            next[index] = {
              ...current,
              ...(op.enabled !== undefined && { enabled: op.enabled }),
              server,
            };
            break;
          }
          case 'remove': {
            next = next.filter((entry) => entry.id !== op.id);
            break;
          }
          default:
            return never(op, 'custom MCP patch op');
        }
      }
      return Effect.tryPromise({
        try: async () => {
          await this.store.setCustomMcpServers(next);
        },
        catch: (cause) =>
          new OperationError({
            subsystem: 'store',
            operation: 'config.set-custom-mcp',
            publicMessage: 'Failed to persist the MCP server config',
            cause,
          }),
      });
    });
  }
}

export function maskCustomMcpServer(entry: CustomMcpServer): CustomMcpServerPublic {
  return {
    id: entry.id,
    enabled: entry.enabled,
    server: maskMcpServer(entry.server),
    createdAt: entry.createdAt,
  };
}

function maskMcpServer(server: McpServer): McpServerPublic {
  if (server.type === 'stdio') {
    return {
      type: 'stdio',
      name: server.name,
      command: server.command,
      args: server.args,
      envKeys: Object.keys(server.env ?? {}),
    };
  }
  return {
    type: 'http',
    name: server.name,
    url: server.url,
    headerKeys: Object.keys(server.headers ?? {}),
  };
}

/** Non-secret fields replace wholesale; env/headers patch per key ("blank = keep"). A transport
 * change is expressed as remove + add by the client, so a mismatched type is a bad request. */
function applyServerUpdate(
  current: McpServer,
  update: McpServerUpdate,
  siblings: CustomMcpServer[],
  selfId: string,
): McpServer | RequestError {
  if (current.type !== update.type) {
    return new RequestError({
      code: 'invalid_request',
      message: 'The transport type cannot change on update; remove the server and re-add it',
    });
  }
  const conflict = validateName(update.name, siblings, selfId);
  if (conflict) return conflict;
  if (current.type === 'stdio' && update.type === 'stdio') {
    return {
      type: 'stdio',
      name: update.name,
      command: update.command,
      args: update.args,
      env: applySecretPatch(current.env, update.env),
    };
  }
  if (current.type === 'http' && update.type === 'http') {
    return {
      type: 'http',
      name: update.name,
      url: update.url,
      headers: applySecretPatch(current.headers, update.headers),
    };
  }
  return new RequestError({ code: 'invalid_request', message: 'Malformed server update' });
}

function applySecretPatch(
  current: Record<string, string> | undefined,
  patch: McpSecretPatch | undefined,
): Record<string, string> | undefined {
  if (!patch) return current;
  const removed = new Set(patch.remove);
  const next: Record<string, string> = {};
  const merged = Object.entries({ ...current, ...patch.set });
  for (let i = 0, len = merged.length; i < len; i++) {
    const [key, value] = merged[i];
    if (!removed.has(key)) next[key] = value;
  }
  return isObjectEmpty(next) ? undefined : next;
}

function validateName(
  name: string,
  existing: CustomMcpServer[],
  excludeId: string | undefined,
): RequestError | undefined {
  if (RESERVED_MCP_SERVER_NAMES.has(name)) {
    return new RequestError({
      code: 'conflict',
      message: `"${name}" is a reserved MCP server name`,
    });
  }
  if (existing.some((entry) => entry.id !== excludeId && entry.server.name === name)) {
    return new RequestError({
      code: 'conflict',
      message: `MCP server name already in use: ${name}`,
    });
  }
  return undefined;
}
