import { useLinkCodeClient } from '@linkcode/client-core';
import { enabledAccountModels } from '@linkcode/providers';
import type { Accounts, AgentKind, ProvidersConfig } from '@linkcode/schema';
import type { ModelOption } from '@linkcode/ui/native';
import { noop } from 'foxact/noop';
import { useEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';

/** Account-backed model options for one agent; null until both daemon-owned sources load, so the
 * picker never briefly offers a set the enabled list would have narrowed. The head of the list is
 * what an unpicked start runs on. The agent's own catalog models are deliberately not offered — a
 * model nobody enabled an account for is not on offer (same rule as the desktop draft picker). */
export function useAccountModels(kind: AgentKind): ModelOption[] | null {
  const client = useLinkCodeClient();
  const [sources, setSources] = useState<{
    accounts: Accounts;
    providers: ProvidersConfig;
  } | null>(null);

  useEffect(
    (signal) => {
      Promise.all([client.getAccounts(), client.getProviderConfig()])
        .then(([accounts, providers]) => {
          if (!signal.aborted) setSources({ accounts, providers });
        })
        .catch(noop);
    },
    [client],
  );

  if (!sources) return null;
  // `description` carries the account label and `accountId` rides along, so a pick names the
  // account it came from — two accounts can legitimately serve the same model id.
  return enabledAccountModels(sources.accounts, sources.providers, kind).map(
    ({ account, model }) => ({
      id: model.id,
      label: model.label ?? model.id,
      description: account.label,
      accountId: account.id,
    }),
  );
}
