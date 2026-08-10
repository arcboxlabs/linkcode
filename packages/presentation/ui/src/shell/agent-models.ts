import type { EffortLevel } from '@linkcode/schema';

export interface ModelOption {
  id: string;
  label: string;
  /** The account offering this model, when the list spans several. Two accounts can serve the same
   * `id`, so this is what makes an entry identifiable — see {@link modelChoiceKey}. */
  accountId?: string;
  /** Secondary line in the picker (adapter-advertised catalogs carry the provider name here,
   * disambiguating same-named models across providers); static table entries omit it. */
  description?: string;
  /** Per-model effort capability from a dynamic adapter catalog. */
  effortLevels?: EffortLevel[];
  /** The effort this model runs at unpicked, when the catalog advertises one. */
  defaultEffort?: EffortLevel;
}

export interface ModelProviderGroups {
  /** Options without a provider subtitle, rendered flat before the provider submenus. */
  ungrouped: ModelOption[];
  groups: Array<{ label: string; options: ModelOption[] }>;
}

/**
 * Identity of one entry in a model menu. The model id alone is not unique once a list spans
 * accounts — a direct DeepSeek account and an OpenRouter one both serve `deepseek-v4-pro` — and
 * reusing it as a React key or a radio value collapses the two into one unselectable row.
 */
export function modelChoiceKey(option: ModelOption): string {
  return `${option.accountId ?? ''}:${option.id}`;
}

/** Whether picking this entry leaves the account a session is currently running on. Credentials and
 * base URL are injected once at spawn, so such a pick relaunches the agent rather than rebinding it
 * in place. Unknown accounts on either side mean the question doesn't apply. */
export function switchesAccount(
  option: ModelOption,
  currentAccountId: string | undefined,
): boolean {
  return (
    currentAccountId !== undefined &&
    option.accountId !== undefined &&
    option.accountId !== currentAccountId
  );
}

/** Group a catalog by its provider subtitle (`description`, per the adapter convention above),
 * preserving catalog order within groups and first-appearance order across them. Returns null
 * below two distinct providers — a single-provider list reads better flat. */
export function groupModelsByProvider(
  options: readonly ModelOption[] | undefined,
): ModelProviderGroups | null {
  const ungrouped: ModelOption[] = [];
  const byProvider = new Map<string, ModelOption[]>();
  for (const option of options ?? []) {
    if (option.description === undefined) {
      ungrouped.push(option);
      continue;
    }
    const group = byProvider.get(option.description);
    if (group) group.push(option);
    else byProvider.set(option.description, [option]);
  }
  if (byProvider.size < 2) return null;
  return {
    ungrouped,
    groups: Array.from(byProvider, ([label, grouped]) => ({ label, options: grouped })),
  };
}

/** Resolve a reflected model id (from `model-update`) to its catalog entry. The daemon emits the
 * *served* id, which may be a pinned snapshot of an alias (e.g. `claude-haiku-4-5-20251001`);
 * prefix-match only after an exact match fails so `gpt-5.4-mini` never mis-resolves to `gpt-5.4`.
 * `accountId` narrows first where known, so a list spanning accounts labels the right entry. */
export function resolveModel(
  options: readonly ModelOption[] | undefined,
  id: string | null,
  accountId?: string,
): ModelOption | undefined {
  if (id === null) return undefined;
  const scoped =
    accountId === undefined ? options : options?.filter((option) => option.accountId === accountId);
  const candidates = scoped?.length ? scoped : options;
  return (
    candidates?.find((option) => option.id === id) ??
    candidates?.find((option) => id.startsWith(`${option.id}-`))
  );
}
