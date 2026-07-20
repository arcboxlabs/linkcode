import type { AgentKind, EffortLevel } from '@linkcode/schema';

export interface ModelOption {
  id: string;
  label: string;
  /** Secondary line in the picker (adapter-advertised catalogs carry the provider name here,
   * disambiguating same-named models across providers); static table entries omit it. */
  description?: string;
  /** Per-model effort capability from a dynamic adapter catalog. */
  effortLevels?: EffortLevel[];
}

export interface ModelProviderGroups {
  /** Options without a provider subtitle, rendered flat before the provider submenus. */
  ungrouped: ModelOption[];
  groups: { label: string; options: ModelOption[] }[];
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
    groups: [...byProvider.entries()].map(([label, grouped]) => ({ label, options: grouped })),
  };
}

/** Resolve a reflected model id (from `model-update`) to its catalog entry. The daemon emits the
 * *served* id, which may be a pinned snapshot of an alias (e.g. `claude-haiku-4-5-20251001`);
 * prefix-match only after an exact match fails so `gpt-5.4-mini` never mis-resolves to `gpt-5.4`. */
export function resolveModel(
  options: readonly ModelOption[] | undefined,
  id: string | null,
): ModelOption | undefined {
  if (id === null) return undefined;
  return (
    options?.find((option) => option.id === id) ??
    options?.find((option) => id.startsWith(`${option.id}-`))
  );
}

/** Verified provider defaults used before a session exists to reflect its served model. A saved
 * account/provider default supplied by the workbench takes precedence over these values. */
export const AGENT_DEFAULT_MODELS: Readonly<Partial<Record<AgentKind, string>>> = {
  'claude-code': 'claude-sonnet-5',
  codex: 'gpt-5.6-sol',
  'grok-build': 'grok-4.5',
};

/**
 * Curated model choices, keyed by adapter — only adapters with a *verified* live model switch get
 * an entry, and every id was confirmed by reading the served model back off a live stream (source
 * reading is not enough: claude-code's first design silently ignored the override). Legacy models
 * are included deliberately — the choice belongs to the user.
 * claude-opus-4-1 is deliberately excluded: setModel() accepts it but claude-opus-4-8 is silently
 * served instead. Offering claude-fable-5 to everyone is safe: accounts without access get a hard
 * CLI error and the picker keeps the previous model (confirm-then-reflect).
 * Keeping this table static is a deliberate CODE-104 decision (the dynamic reference
 * implementation lives in closed PR #52); refresh it by hand under the discipline above.
 * codex ids/labels are the app-server's `model/list` verbatim; switches apply from the next turn,
 * not mid-turn. opencode and pi have no entry — see their adapters' comments for why.
 */
export const AGENT_MODEL_OPTIONS: Partial<Record<AgentKind, ModelOption[]>> = {
  'claude-code': [
    { id: 'claude-fable-5', label: 'Fable 5' },
    { id: 'claude-opus-4-8', label: 'Opus 4.8' },
    { id: 'claude-opus-4-7', label: 'Opus 4.7 (Legacy)' },
    { id: 'claude-opus-4-6', label: 'Opus 4.6 (Legacy)' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (Legacy)' },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
  ],
  codex: [
    { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra' },
    { id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna' },
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini' },
  ],
  // Grok Build headless: model is a spawn-time `-m` flag (verified 0.2.102: grok-4.5).
  'grok-build': [{ id: 'grok-4.5', label: 'Grok 4.5' }],
};
