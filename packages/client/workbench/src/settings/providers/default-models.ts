import { resolveBinding } from '@linkcode/providers';
import type { Account, Accounts, AgentKind, ProvidersConfig } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { getAccounts, getProviderConfig } from '@linkcode/sdk';
import type { ModelOption } from '@linkcode/ui';
import { useData } from '../../runtime/tayori';

/** Each agent's configured default model — what a session starts on when nothing picked one, and
 * what automation and scheduled runs always use. A running thread keeps its own pick instead. */
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

/** The account each agent falls back to when a session names none. An agent absent here resolves
 * its own credentials, so nothing about it is the account world's business. */
export function configuredDefaultAccounts(
  providers: ProvidersConfig | undefined,
): Partial<Record<AgentKind, string>> {
  const defaults: Partial<Record<AgentKind, string>> = {};
  for (const kind of AgentKindSchema.options) {
    const accountId = providers?.[kind]?.activeAccountId;
    if (accountId !== undefined) defaults[kind] = accountId;
  }
  return defaults;
}

/** Undefined until the config has loaded, so a draft never briefly treats an agent as running on
 * its own login when it actually resolves through an account. */
export function useConfiguredDefaultAccounts(): Partial<Record<AgentKind, string>> | undefined {
  const { data: providers } = useData(getProviderConfig, {});
  if (providers === undefined) return undefined;
  return configuredDefaultAccounts(providers);
}

/**
 * Every model this agent offers: the picked sets of each account that can back it *and* is enabled
 * for it. Choosing a model therefore also chooses its account, which is what lets one agent reach
 * several providers without a trip through Settings. Live sessions read the same list — a
 * cross-account pick there restarts the thread on that account rather than rebinding in place.
 *
 * `description` carries the account label so `groupModelsByProvider` renders one submenu per
 * account, and `accountId` rides along so the pick names the account it came from — two accounts
 * legitimately serve the same model id.
 *
 * Present-but-empty and absent mean different things, and callers rely on the difference. An entry
 * exists whenever at least one account can back the agent, so `[]` says "available, nothing picked
 * yet" and blocks sends the way the daemon does. Absent says "no account can back this agent", where
 * it still resolves its own model — pickers fall through to the adapter catalog or the curated table,
 * and nothing blocks. Disabling every account for an agent therefore blocks it rather than silently
 * handing it back to the adapter's own choice.
 */
export function accountModelOptions(
  accounts: Accounts | undefined,
  providers?: ProvidersConfig,
): Partial<Record<AgentKind, ModelOption[]>> {
  const options: Partial<Record<AgentKind, ModelOption[]>> = {};
  for (const kind of AgentKindSchema.options) {
    const bindable = (accounts ?? []).filter(
      (account) => resolveBinding(account, kind).tier !== 'unavailable',
    );
    if (bindable.length === 0) continue;
    const enabled = providers?.[kind]?.enabledAccountIds;
    const offered =
      enabled === undefined ? bindable : bindable.filter((account) => enabled.includes(account.id));
    options[kind] = offered.flatMap((account) => modelOptionsOf(account));
  }
  return options;
}

/** Whether this account's models are offered for this agent. Absent list means every bindable one,
 * so a newly added account is offered without a visit to Settings. */
export function accountEnabledFor(
  providers: ProvidersConfig | undefined,
  kind: AgentKind,
  accountId: string,
): boolean {
  const enabled = providers?.[kind]?.enabledAccountIds;
  return enabled === undefined || enabled.includes(accountId);
}

function modelOptionsOf(account: Account): ModelOption[] {
  return (account.models ?? []).map(({ id, label }) => ({
    id,
    label: label ?? id,
    description: account.label,
    accountId: account.id,
  }));
}

/** `null` until both daemon-owned sources have loaded, so a picker never briefly offers a set that
 * is not actually available — or one the enabled list would have narrowed. */
export function useAccountModelOptions(): Partial<Record<AgentKind, ModelOption[]>> | null {
  const { data: accounts } = useData(getAccounts, {});
  const { data: providers } = useData(getProviderConfig, {});
  if (accounts === undefined || providers === undefined) return null;
  return accountModelOptions(accounts, providers);
}
