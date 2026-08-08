import type { AgentKind, EffortLevel } from '@linkcode/schema';

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

/**
 * The models a surface may offer. An agent resolving *through* an account offers that account world
 * alone. One running on its own login keeps its own catalog and merely *gains* the accounts as extra
 * options — replacing it would let a key added for one agent hijack another's menu, since agents
 * that accept any endpoint (opencode, pi) treat every account as bindable.
 */
export function pickableModels(
  accountSet: ModelOption[] | null | undefined,
  ownCatalog: ModelOption[] | null | undefined,
  { throughAccount }: { throughAccount: boolean },
): ModelOption[] | undefined {
  // Null and absent both mean "this source offers nothing"; only present-and-empty is a real set.
  if (throughAccount) return accountSet ?? undefined;
  if (accountSet === null || accountSet === undefined) return ownCatalog ?? undefined;
  if (ownCatalog === null || ownCatalog === undefined) return accountSet;
  return [...accountSet, ...ownCatalog];
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

const CODEX_BASE_EFFORTS = ['low', 'medium', 'high', 'xhigh'] satisfies EffortLevel[];

/**
 * Curated model choices, keyed by adapter — only adapters with a *verified* live model switch get
 * an entry, and every id was confirmed by reading the served model back off a live stream (source
 * reading is not enough: claude-code's first design silently ignored the override). Legacy models
 * are included deliberately — the choice belongs to the user. Anthropic ids and lifecycle come from
 * https://platform.claude.com/docs/en/about-claude/models/overview.
 * claude-opus-4-1 is deliberately excluded: setModel() accepts it but claude-opus-5 is silently
 * served instead. Offering claude-fable-5 to everyone is safe: accounts without access get a hard
 * CLI error and the picker keeps the previous model (confirm-then-reflect).
 * `[1m]` ids (`claude-opus-5[1m]`) are a claude-code-side context tier, not Anthropic model ids;
 * none are listed, and resolveModel() cannot fold one back onto its base entry.
 * Keeping this table static is a deliberate CODE-104 decision (the dynamic reference
 * implementation lives in closed PR #52); refresh it by hand under the discipline above.
 * codex ids/labels are the app-server's `model/list` verbatim; switches apply from the next turn,
 * not mid-turn. opencode and pi have no entry — see their adapters' comments for why.
 */
export const AGENT_MODEL_OPTIONS: Partial<Record<AgentKind, ModelOption[]>> = {
  'claude-code': [
    { id: 'claude-fable-5', label: 'Fable 5' },
    { id: 'claude-opus-5', label: 'Opus 5' },
    { id: 'claude-opus-4-8', label: 'Opus 4.8' },
    { id: 'claude-opus-4-7', label: 'Opus 4.7 (Legacy)' },
    { id: 'claude-opus-4-6', label: 'Opus 4.6 (Legacy)' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (Legacy)' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  ],
  codex: [
    {
      id: 'gpt-5.6-sol',
      label: 'GPT-5.6-Sol',
      effortLevels: [...CODEX_BASE_EFFORTS, 'max', 'ultra'],
    },
    {
      id: 'gpt-5.6-terra',
      label: 'GPT-5.6-Terra',
      effortLevels: [...CODEX_BASE_EFFORTS, 'max', 'ultra'],
    },
    {
      id: 'gpt-5.6-luna',
      label: 'GPT-5.6-Luna',
      effortLevels: [...CODEX_BASE_EFFORTS, 'max'],
    },
    { id: 'gpt-5.5', label: 'GPT-5.5', effortLevels: [...CODEX_BASE_EFFORTS] },
    { id: 'gpt-5.4', label: 'GPT-5.4', effortLevels: [...CODEX_BASE_EFFORTS] },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini', effortLevels: [...CODEX_BASE_EFFORTS] },
  ],
  // Grok Build headless: model is a spawn-time `-m` flag (verified 0.2.102: grok-4.5).
  'grok-build': [{ id: 'grok-4.5', label: 'Grok 4.5' }],
};
