import { useLinkCodeClient } from '@linkcode/client-core';
import type { AgentKind, AgentStartCatalog } from '@linkcode/schema';
import { noop } from 'foxact/noop';
import { useEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';

/** Pre-session capability catalog for one agent in one workspace; null while loading or when the
 * host cannot answer. `cwd` is load-bearing: adapters resolve workspace-scoped defaults from it
 * (claude-code reads `.claude/settings*.json`), so every (kind, cwd) pair refetches. */
export function useAgentStartCatalog(
  kind: AgentKind,
  cwd: string | null,
): AgentStartCatalog | null {
  const client = useLinkCodeClient();
  const [entry, setEntry] = useState<{ key: string; catalog: AgentStartCatalog } | null>(null);

  const key = `${kind}:${cwd ?? ''}`;
  useEffect(
    (signal) => {
      client
        .getAgentCatalog(kind, cwd ?? undefined)
        .then((catalog) => {
          if (!signal.aborted) setEntry({ key, catalog });
        })
        .catch(noop);
    },
    [client, kind, cwd, key],
  );

  // Keyed so a stale catalog never answers for the wrong (kind, cwd) while the next one loads.
  return entry?.key === key ? entry.catalog : null;
}
