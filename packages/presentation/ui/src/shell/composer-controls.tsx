import type { AgentKind, ApprovalPolicy, EffortLevel, SessionMode } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from 'coss-ui/components/menu';
import { Separator } from 'coss-ui/components/separator';
import {
  BrainCircuitIcon,
  ChevronDownIcon,
  ListTodoIcon,
  PlusIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  TargetIcon,
} from 'lucide-react';
import { useTranslations } from 'use-intl';
import { AGENT_LABELS, AgentIcon } from '../chat/agent-icon';
import type { EffortOption } from './agent-efforts';
import { EFFORT_OPTIONS_BY_ID } from './agent-efforts';
import type { ModelOption } from './agent-models';
import { groupModelsByProvider, resolveModel } from './agent-models';
import type { AgentRuntimeCue, AgentRuntimeCues } from './agent-onboarding-card';

// Linear lookup: the policy/effort lists are a handful of entries at most.
function optionById<T extends { id: string }>(
  options: readonly T[] | undefined,
  id: string | null,
): T | undefined {
  for (const option of options ?? []) {
    if (option.id === id) return option;
  }
  return undefined;
}

/** The `+` trigger for the composer's shared command popup. */
export function ComposerPlusMenu({
  disabled,
  onOpenPlusCommand,
}: {
  disabled: boolean;
  onOpenPlusCommand: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.composer');

  return (
    <Button
      aria-label={t('add')}
      className="rounded-full text-muted-foreground"
      disabled={disabled}
      onClick={onOpenPlusCommand}
      size="icon-sm"
      type="button"
      variant="ghost"
    >
      <PlusIcon />
    </Button>
  );
}

/** The approval-policy picker — the permission/safety axis the agent advertises via
 * `approval-policy-update` (see `ApprovalPolicyState` in @linkcode/schema). */
export function ApprovalPolicyMenu({
  agentLabel,
  disabled,
  policies,
  currentPolicyId,
  onSelect,
}: {
  agentLabel: string;
  disabled: boolean;
  policies: ApprovalPolicy[];
  currentPolicyId: string | null;
  onSelect: (policyId: string) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.composer');
  if (policies.length === 0) return null;
  const active = policies.find((policy) => policy.policyId === currentPolicyId) ?? policies[0];

  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        render={
          <Button
            className="text-muted-foreground @max-[480px]/composer:size-8 @max-[480px]/composer:p-0"
            size="sm"
            title={active.name}
            type="button"
            variant="ghost"
          />
        }
      >
        <ShieldIcon />
        <span className="@max-[480px]/composer:sr-only">{active.name}</span>
        <ChevronDownIcon className="size-3 text-muted-foreground/72 @max-[480px]/composer:hidden" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-80" side="top" sideOffset={8}>
        <MenuGroup>
          <MenuGroupLabel>{t('approvalTitle', { agent: agentLabel })}</MenuGroupLabel>
          <MenuRadioGroup
            value={active.policyId}
            onValueChange={(value) => onSelect(String(value))}
          >
            {policies.map((policy) => (
              <MenuRadioItem
                key={policy.policyId}
                className="py-1.5"
                closeOnClick
                value={policy.policyId}
              >
                <span className="flex min-w-0 flex-col">
                  <span>{policy.name}</span>
                  {policy.description ? (
                    <span className="text-muted-foreground text-xs">{policy.description}</span>
                  ) : null}
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

// Known workflow-mode glyphs; unknown provider modes fall back to a generic one.
const MODE_CHIP_ICONS: Record<string, typeof ListTodoIcon> = {
  plan: ListTodoIcon,
  goal: TargetIcon,
};

/** The chip shown while a workflow mode is active; clicking it toggles the mode off. */
export function SessionModeChip({
  disabled,
  mode,
  onToggle,
}: {
  disabled: boolean;
  mode: SessionMode;
  onToggle: () => void;
}): React.ReactNode {
  const Icon = MODE_CHIP_ICONS[mode.modeId] ?? SlidersHorizontalIcon;

  return (
    <>
      <Separator className="h-4" orientation="vertical" />
      <Button
        className="text-muted-foreground"
        disabled={disabled}
        onClick={onToggle}
        size="sm"
        title={mode.name}
        type="button"
        variant="ghost"
      >
        <Icon />
        <span className="@max-[480px]/composer:sr-only">{mode.name}</span>
      </Button>
    </>
  );
}

/** Availability badge on a provider submenu item; nothing renders for a ready runtime. */
function RuntimeCueBadge({ cue }: { cue?: AgentRuntimeCue }): React.ReactNode {
  const t = useTranslations('workbench.agentRuntime');
  if (!cue) return null;
  const variant =
    cue.state === 'missing' || cue.state === 'needs-login'
      ? 'outline'
      : cue.state === 'downloading'
        ? 'info'
        : cue.state === 'failed'
          ? 'error'
          : 'warning';
  const label =
    cue.state === 'missing'
      ? t('badgeMissing')
      : cue.state === 'downloading'
        ? t('badgeDownloading')
        : cue.state === 'failed'
          ? t('badgeFailed')
          : cue.state === 'needs-login'
            ? t('badgeNeedsLogin')
            : t('badgeUnverified');
  return (
    <Badge className="font-normal" variant={variant}>
      {label}
    </Badge>
  );
}

/** Codex-style model trigger: [provider glyph] model + effort, opening reasoning/model/provider menus. */
export function ModelSelectorMenu({
  disabled,
  provider,
  selectableProviders,
  runtimeCues,
  modelOptions,
  effortOptions,
  selectedModelId,
  selectedEffortId,
  onSelectModel,
  onSelectEffort,
  onResetModel,
  onResetEffort,
  onSelectProvider,
}: {
  disabled: boolean;
  provider?: AgentKind;
  /** Providers offered for selection; absent/empty when the session's provider is fixed. */
  selectableProviders?: AgentKind[];
  /** Runtime availability per provider: a cue renders as a muted badge on the submenu item. */
  runtimeCues?: AgentRuntimeCues;
  modelOptions?: ModelOption[];
  effortOptions?: EffortOption[];
  selectedModelId: string | null;
  selectedEffortId: EffortLevel | null;
  onSelectModel: (model: string) => void;
  onSelectEffort: (effort: EffortLevel) => void;
  /** Draft-only escape hatch back to the provider/configured model default. */
  onResetModel?: () => void;
  /** Draft-only escape hatch back to the provider effort default. */
  onResetEffort?: () => void;
  onSelectProvider?: (provider: AgentKind) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.composer');
  const selectedModel = resolveModel(modelOptions, selectedModelId);
  const providerGroups = groupModelsByProvider(modelOptions);
  const selectedEffort =
    optionById(effortOptions, selectedEffortId) ??
    (selectedEffortId ? EFFORT_OPTIONS_BY_ID[selectedEffortId] : undefined);
  const providers = selectableProviders ?? [];
  const hasEfforts = Boolean(effortOptions?.length);
  const hasModels = Boolean(modelOptions?.length);
  const modelLabel = selectedModel?.label ?? selectedModelId ?? t('modelDefault');
  const effortLabel = selectedEffort?.label ?? t('effortDefault');
  // A draft provider picker must keep the model axis visible even when that provider discovers
  // its concrete model only after session start (OpenCode/Pi). The live update replaces Default.
  const showsModel = providers.length > 0 || hasModels || selectedModelId !== null;

  if (!hasEfforts && !showsModel && providers.length === 0) return null;
  const selectorLabels: string[] = [];
  if (provider) selectorLabels.push(AGENT_LABELS[provider]);
  if (showsModel) selectorLabels.push(modelLabel);
  if (hasEfforts) selectorLabels.push(`${t('reasoning')}: ${effortLabel}`);

  return (
    <Menu>
      <MenuTrigger
        aria-label={selectorLabels.join(', ')}
        disabled={disabled}
        render={<Button className="shrink-0" size="sm" type="button" variant="ghost" />}
      >
        {providers.length > 0 && provider ? <AgentIcon kind={provider} variant="brand" /> : null}
        {showsModel ? modelLabel : null}
        {hasEfforts ? (
          <span className="flex items-center gap-2 font-normal text-muted-foreground">
            <span aria-hidden>·</span>
            <span className="@max-[480px]/composer:sr-only">{effortLabel}</span>
            <span aria-hidden className="hidden @max-[480px]/composer:inline">
              {selectedEffort?.shortLabel ?? t('effortShort')}
            </span>
          </span>
        ) : null}
        <ChevronDownIcon className="size-3 text-muted-foreground/72" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-56" side="top" sideOffset={8}>
        {onResetModel ? <MenuItem onClick={onResetModel}>{t('useDefaultModel')}</MenuItem> : null}
        {onResetEffort ? (
          <MenuItem onClick={onResetEffort}>{t('useDefaultEffort')}</MenuItem>
        ) : null}
        {onResetModel || onResetEffort ? <MenuSeparator /> : null}
        {hasEfforts ? (
          <MenuGroup>
            <MenuGroupLabel>{t('reasoning')}</MenuGroupLabel>
            <MenuRadioGroup
              value={selectedEffortId ?? ''}
              onValueChange={(value) => onSelectEffort(value as EffortLevel)}
            >
              {effortOptions?.map((option) => (
                <MenuRadioItem key={option.id} closeOnClick value={option.id}>
                  {option.label}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        ) : null}
        {hasModels ? (
          <>
            {hasEfforts ? <MenuSeparator /> : null}
            <MenuSub>
              <MenuSubTrigger>
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <BrainCircuitIcon className="size-4" />
                </span>
                {modelLabel}
              </MenuSubTrigger>
              <MenuSubPopup className="w-56">
                <MenuRadioGroup
                  value={selectedModel?.id ?? selectedModelId ?? ''}
                  onValueChange={(value) => onSelectModel(String(value))}
                >
                  {providerGroups === null ? (
                    modelOptions?.map((option) => (
                      <MenuRadioItem key={option.id} closeOnClick value={option.id}>
                        <span className="flex min-w-0 flex-col">
                          <span>{option.label}</span>
                          {option.description ? (
                            <span className="text-muted-foreground text-xs">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </MenuRadioItem>
                    ))
                  ) : (
                    <>
                      {providerGroups.ungrouped.map((option) => (
                        <MenuRadioItem key={option.id} closeOnClick value={option.id}>
                          {option.label}
                        </MenuRadioItem>
                      ))}
                      {/* One submenu per provider; the trigger names the provider, so items drop
                       * the subtitle the flat list needs for disambiguation. */}
                      {providerGroups.groups.map((group) => (
                        <MenuSub key={group.label}>
                          <MenuSubTrigger>{group.label}</MenuSubTrigger>
                          <MenuSubPopup className="w-56">
                            {group.options.map((option) => (
                              <MenuRadioItem key={option.id} closeOnClick value={option.id}>
                                {option.label}
                              </MenuRadioItem>
                            ))}
                          </MenuSubPopup>
                        </MenuSub>
                      ))}
                    </>
                  )}
                </MenuRadioGroup>
              </MenuSubPopup>
            </MenuSub>
          </>
        ) : null}
        {providers.length > 0 && onSelectProvider ? (
          <MenuSub>
            <MenuSubTrigger>
              {provider ? (
                <>
                  <AgentIcon kind={provider} variant="brand" />
                  {AGENT_LABELS[provider]}
                </>
              ) : (
                t('provider')
              )}
            </MenuSubTrigger>
            <MenuSubPopup className="w-60">
              <MenuRadioGroup
                value={provider ?? ''}
                onValueChange={(value) => onSelectProvider(value as AgentKind)}
              >
                {providers.map((kind) => (
                  <MenuRadioItem key={kind} className="pe-2" closeOnClick value={kind}>
                    <span className="flex min-w-0 items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <AgentIcon kind={kind} variant="brand" />
                        <span className="truncate">{AGENT_LABELS[kind]}</span>
                      </span>
                      <RuntimeCueBadge cue={runtimeCues?.[kind]} />
                    </span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuSubPopup>
          </MenuSub>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
