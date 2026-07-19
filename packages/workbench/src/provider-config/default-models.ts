import type { Accounts, AgentKind, ProvidersConfig } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { getAccounts, getProviderConfig } from '@linkcode/sdk';
import { useData } from '../runtime/tayori';

/** Resolve the daemon configuration's effective model per agent using the same precedence as
 * session start: the active account overrides the provider-level default. */
export function configuredDefaultModels(
  providers: ProvidersConfig | undefined,
  accounts: Accounts | undefined,
): Partial<Record<AgentKind, string>> {
  const defaults: Partial<Record<AgentKind, string>> = {};
  for (const kind of AgentKindSchema.options) {
    const provider = providers?.[kind];
    const account = accounts?.find((candidate) => candidate.id === provider?.activeAccountId);
    const model = account?.model ?? provider?.defaultModel;
    if (model !== undefined) defaults[kind] = model;
  }
  return defaults;
}

/** Configured defaults for new-session controls. Built-in provider defaults remain presentation
 * knowledge in `@linkcode/ui`; this hook only reflects daemon-owned user configuration. */
export function useConfiguredDefaultModels(): Partial<Record<AgentKind, string>> {
  const { data: providers } = useData(getProviderConfig, {});
  const { data: accounts } = useData(getAccounts, {});
  return configuredDefaultModels(providers, accounts);
}
