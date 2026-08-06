import type { Accounts, AgentKind, AgentModelOption, ProvidersConfig } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { getAccounts, getProviderConfig } from '@linkcode/sdk';
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
 * The models each agent may be switched to: the set picked on its bound account, and nothing else.
 *
 * Present-but-empty and absent mean different things, and callers rely on the difference. An entry
 * exists for every agent with an account bound, so `[]` says "bound, nothing picked yet" and blocks
 * sends the way the daemon does. Absent says "no account bound", where the agent still resolves its
 * own model — so its pickers fall through to the adapter catalog or the curated table, and nothing
 * blocks.
 */
export function accountModelOptions(
  providers: ProvidersConfig | undefined,
  accounts: Accounts | undefined,
): Partial<Record<AgentKind, AgentModelOption[]>> {
  const options: Partial<Record<AgentKind, AgentModelOption[]>> = {};
  for (const kind of AgentKindSchema.options) {
    const accountId = providers?.[kind]?.activeAccountId;
    if (accountId === undefined) continue;
    const models = accounts?.find((candidate) => candidate.id === accountId)?.models ?? [];
    options[kind] = models.map(({ id, label }) => ({ id, label: label ?? id }));
  }
  return options;
}

/** `null` until both daemon-owned sources have loaded, so a picker never briefly offers a set the
 * account does not actually have. */
export function useAccountModelOptions(): Partial<Record<AgentKind, AgentModelOption[]>> | null {
  const { data: providers } = useData(getProviderConfig, {});
  const { data: accounts } = useData(getAccounts, {});
  if (providers === undefined || accounts === undefined) return null;
  return accountModelOptions(providers, accounts);
}
