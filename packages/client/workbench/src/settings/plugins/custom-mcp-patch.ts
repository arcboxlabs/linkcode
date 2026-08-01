import type {
  CustomMcpServerPatchOp,
  CustomMcpServerPublic,
  McpSecretPatch,
  McpServer,
} from '@linkcode/schema';
import { isObjectEmpty } from 'foxts/is-object-empty';

/**
 * The add/edit dialog's normalized output. Secret rows follow the masked-edit contract: an
 * existing key renders with an EMPTY value ("configured" placeholder) — empty means keep, a typed
 * value means replace, `remove` stages deletion. New rows with empty values are dropped.
 */
export interface CustomMcpSecretRow {
  key: string;
  value: string;
  remove?: boolean;
}

export type CustomMcpServerDraft =
  | {
      type: 'stdio';
      name: string;
      command: string;
      args: string[];
      secrets: CustomMcpSecretRow[];
    }
  | {
      type: 'http';
      name: string;
      url: string;
      secrets: CustomMcpSecretRow[];
    };

export interface CustomMcpMint {
  id: string;
  createdAt: number;
}

/**
 * Diff a dialog draft against the masked previous state into config.set patch ops. This is the
 * single place secret-clobber bugs could hide: the client never holds secret values, so it must
 * express edits per key and never resend whole servers.
 *
 * - no previous → one `add` (mint supplies id/createdAt);
 * - transport changed → `remove` + `add` (secrets must be re-entered — nothing carries over);
 * - same transport → one `update` with per-key `{set, remove}`, or `[]` when nothing changed.
 */
export function buildCustomMcpPatch(
  previous: CustomMcpServerPublic | undefined,
  draft: CustomMcpServerDraft,
  mint: CustomMcpMint,
): CustomMcpServerPatchOp[] {
  if (!previous) return [{ op: 'add', server: mintedServer(draft, mint, true) }];
  if (previous.server.type !== draft.type) {
    return [
      { op: 'remove', id: previous.id },
      { op: 'add', server: mintedServer(draft, mint, previous.enabled) },
    ];
  }
  const previousKeys = new Set(
    previous.server.type === 'stdio' ? previous.server.envKeys : previous.server.headerKeys,
  );
  const secrets = diffSecrets(draft.secrets, previousKeys);
  const nonSecretChanged =
    previous.server.name !== draft.name ||
    (previous.server.type === 'stdio' && draft.type === 'stdio'
      ? previous.server.command !== draft.command ||
        !sameArgs(previous.server.args ?? [], draft.args)
      : previous.server.type === 'http' &&
        draft.type === 'http' &&
        previous.server.url !== draft.url);
  if (!nonSecretChanged && !secrets) return [];
  return [
    {
      op: 'update',
      id: previous.id,
      server:
        draft.type === 'stdio'
          ? {
              type: 'stdio',
              name: draft.name,
              command: draft.command,
              args: draft.args.length > 0 ? draft.args : undefined,
              ...(secrets && { env: secrets }),
            }
          : {
              type: 'http',
              name: draft.name,
              url: draft.url,
              ...(secrets && { headers: secrets }),
            },
    },
  ];
}

/** Empty value on an existing key = keep (no entry at all); typed value = set; remove = remove.
 * A brand-new key needs a value to count. */
function diffSecrets(
  rows: readonly CustomMcpSecretRow[],
  previousKeys: ReadonlySet<string>,
): McpSecretPatch | undefined {
  const set: Record<string, string> = {};
  const remove: string[] = [];
  let touched = false;
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    if (row.remove) {
      if (previousKeys.has(key)) {
        remove.push(key);
        touched = true;
      }
      continue;
    }
    if (row.value !== '') {
      set[key] = row.value;
      touched = true;
    }
  }
  if (!touched) return undefined;
  return {
    ...(!isObjectEmpty(set) && { set }),
    ...(remove.length > 0 && { remove }),
  };
}

function mintedServer(draft: CustomMcpServerDraft, mint: CustomMcpMint, enabled: boolean) {
  const secrets: Record<string, string> = {};
  for (const row of draft.secrets) {
    const key = row.key.trim();
    if (key && !row.remove && row.value !== '') secrets[key] = row.value;
  }
  const hasSecrets = !isObjectEmpty(secrets);
  const server: McpServer =
    draft.type === 'stdio'
      ? {
          type: 'stdio',
          name: draft.name,
          command: draft.command,
          args: draft.args.length > 0 ? draft.args : undefined,
          env: hasSecrets ? secrets : undefined,
        }
      : {
          type: 'http',
          name: draft.name,
          url: draft.url,
          headers: hasSecrets ? secrets : undefined,
        };
  return { id: mint.id, enabled, server, createdAt: mint.createdAt };
}

function sameArgs(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
