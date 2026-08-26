import { enabledAccountModels, resolveBinding } from '@linkcode/providers';
import type { Accounts, AgentKind, ProvidersConfig } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { getAccounts, getProviderConfig } from '@linkcode/sdk';
import type { ModelOption } from '@linkcode/ui';
import { useData } from '../../runtime/tayori';

/**
 * `enabledAccountModels` dressed for the pickers. Choosing a model therefore also chooses its
 * account, which is what lets one agent reach several providers without a trip through Settings, and
 * the head is what an untouched draft runs on. Live sessions read the same list — a cross-account
 * pick there restarts the thread on that account rather than rebinding in place.
 *
 * `description` carries the account label so `groupModelsByProvider` renders one submenu per
 * account, and `accountId` rides along so the pick names the account it came from — two accounts
 * legitimately serve the same model id.
 *
 * Present-but-empty and absent differ only as description: `[]` is "an account could back this,
 * nothing picked yet", absent is "no account can back it at all". Neither refuses a send — the agent
 * simply resolves its own model, exactly as it does with no account at all.
 */
export function accountModelOptions(
  accounts: Accounts | undefined,
  providers?: ProvidersConfig,
): Partial<Record<AgentKind, ModelOption[]>> {
  const pool = accounts ?? [];
  const options: Partial<Record<AgentKind, ModelOption[]>> = {};
  for (const kind of AgentKindSchema.options) {
    const bindable = pool.some((account) => resolveBinding(account, kind).tier !== 'unavailable');
    if (!bindable) continue;
    options[kind] = enabledAccountModels(pool, providers, kind).map(({ account, model }) => ({
      id: model.id,
      label: model.label ?? model.id,
      description: account.label,
      accountId: account.id,
    }));
  }
  return options;
}

/**
 * Harnesses offered when creating a thread; missing config entries retain the enabled default.
 * `allowedAgents` narrows this further to a restricted brand's build-time allowlist (CODE-618) —
 * `null`/absent means unrestricted, so an unbranded build's result is unaffected.
 */
export function selectableHarnessKinds(
  providers: ProvidersConfig,
  allowedAgents?: readonly AgentKind[] | null,
): AgentKind[] {
  const enabled = AgentKindSchema.options.filter((kind) => providers[kind]?.enabled ?? true);
  if (allowedAgents == null) return enabled;
  const allowed = new Set(allowedAgents);
  return enabled.filter((kind) => allowed.has(kind));
}

/** `null` until both daemon-owned sources have loaded, so a picker never briefly offers a set that
 * is not actually available — or one the enabled list would have narrowed. */
export function useAccountModelOptions(): Partial<Record<AgentKind, ModelOption[]>> | null {
  const { data: accounts } = useData(getAccounts, {});
  const { data: providers } = useData(getProviderConfig, {});
  if (accounts === undefined || providers === undefined) return null;
  return accountModelOptions(accounts, providers);
}
