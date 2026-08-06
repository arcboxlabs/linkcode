import { resolveBinding } from '@linkcode/providers';
import type { Account, Accounts, AgentKind, ProvidersConfig } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { getAccounts, getProviderConfig } from '@linkcode/sdk';
import type { ModelOption } from '@linkcode/ui';
import { useData } from '../../runtime/tayori';

/** The model each agent currently runs on, as session start resolves it: the agent's persisted pick.
 * The bound account contributes the set that pick came from, never the pick itself. */
export function configuredDefaultModels(
  providers: ProvidersConfig | undefined,
): Partial<Record<AgentKind, string>> {
  const picked: Partial<Record<AgentKind, string>> = {};
  for (const kind of AgentKindSchema.options) {
    const model = providers?.[kind]?.model;
    if (model !== undefined) picked[kind] = model;
  }
  return picked;
}

/** Configured defaults for new-session controls. `null` means one of the daemon-owned sources is
 * still unresolved; consumers must not replace that unknown value with a guessed provider model. */
export function useConfiguredDefaultModels(): Partial<Record<AgentKind, string>> | null {
  const { data: providers } = useData(getProviderConfig, {});
  if (providers === undefined) return null;
  return configuredDefaultModels(providers);
}

/**
 * Every model a new session of this agent could run on: the picked sets of *all* accounts the agent
 * can bind, not just the one bound now. Choosing a model therefore also chooses its account, which
 * is what lets one agent reach several providers without a trip through Settings.
 *
 * `description` carries the account label so `groupModelsByProvider` renders one submenu per
 * account, and `accountId` rides along so the pick names the account it came from — two accounts
 * legitimately serve the same model id.
 *
 * Present-but-empty and absent mean different things, and callers rely on the difference. An entry
 * exists whenever at least one account can back the agent, so `[]` says "bindable, nothing picked
 * yet" and blocks sends the way the daemon does. Absent says "no account can back this agent", where
 * it still resolves its own model — pickers fall through to the adapter catalog or the curated table,
 * and nothing blocks.
 */
export function accountModelOptions(
  accounts: Accounts | undefined,
): Partial<Record<AgentKind, ModelOption[]>> {
  const options: Partial<Record<AgentKind, ModelOption[]>> = {};
  for (const kind of AgentKindSchema.options) {
    const bindable = (accounts ?? []).filter(
      (account) => resolveBinding(account, kind).tier !== 'unavailable',
    );
    if (bindable.length === 0) continue;
    options[kind] = bindable.flatMap((account) => modelOptionsOf(account));
  }
  return options;
}

/** One account's picked models. A live session's menu uses this: its account is fixed at spawn, so
 * offering another account's models would advertise a switch the adapter cannot make. */
export function accountModelOptionsFor(
  accounts: Accounts | undefined,
  accountId: string | undefined,
): ModelOption[] | undefined {
  if (accountId === undefined) return undefined;
  const account = accounts?.find((candidate) => candidate.id === accountId);
  return account === undefined ? undefined : modelOptionsOf(account);
}

function modelOptionsOf(account: Account): ModelOption[] {
  return (account.models ?? []).map(({ id, label }) => ({
    id,
    label: label ?? id,
    description: account.label,
    accountId: account.id,
  }));
}

/** `null` until the account pool has loaded, so a picker never briefly offers a set that is not
 * actually available. */
export function useAccountModelOptions(): Partial<Record<AgentKind, ModelOption[]>> | null {
  const { data: accounts } = useData(getAccounts, {});
  if (accounts === undefined) return null;
  return accountModelOptions(accounts);
}

/** The models a live session may switch between — its own account's, and only those. */
export function useSessionModelOptions(accountId: string | undefined): ModelOption[] | undefined {
  const { data: accounts } = useData(getAccounts, {});
  return accountModelOptionsFor(accounts, accountId);
}
