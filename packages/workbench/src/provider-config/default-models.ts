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

/** Configured defaults for new-session controls. `null` means one of the daemon-owned sources is
 * still unresolved; consumers must not replace that unknown value with a guessed provider model. */
export function useConfiguredDefaultModels(): Partial<Record<AgentKind, string>> | null {
  const { data: providers } = useData(getProviderConfig, {});
  const { data: accounts } = useData(getAccounts, {});
  if (providers === undefined || accounts === undefined) return null;
  return configuredDefaultModels(providers, accounts);
}
