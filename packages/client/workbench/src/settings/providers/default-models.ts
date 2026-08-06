import type { AgentKind, ProvidersConfig } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { getProviderConfig } from '@linkcode/sdk';
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
