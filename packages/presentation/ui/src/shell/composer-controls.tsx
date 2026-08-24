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
  ChevronDownIcon,
  ListTodoIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  TargetIcon,
} from 'lucide-react';
import { useTranslations } from 'use-intl';
import { AGENT_LABELS, AgentIcon } from '../chat/agent-icon';
import type { EffortOption } from './agent-efforts';
import { EFFORT_OPTIONS_BY_ID } from './agent-efforts';
import type { ModelOption } from './agent-models';
import {
  groupModelsByProvider,
  modelChoiceKey,
  resolveModel,
  switchesAccount,
} from './agent-models';
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

function policyById(
  policies: readonly ApprovalPolicy[],
  policyId: string | null,
): ApprovalPolicy | undefined {
  for (const policy of policies) {
    if (policy.policyId === policyId) return policy;
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
  const active = policyById(policies, currentPolicyId) ?? policies[0];

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
        <ChevronDownIcon className="size-3 text-label-tertiary @max-[480px]/composer:hidden" />
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

// Known workflow-mode glyphs; unknown harness modes fall back to a generic one.
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

/** Availability badge on a harness submenu item; nothing renders for a ready runtime. */
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

/** One model entry. `description` is the account label the flat list needs to disambiguate; a
 * provider submenu already names it and passes none. */
function ModelMenuItem({
  option,
  description,
  restartHint,
}: {
  option: ModelOption;
  description?: string;
  restartHint?: string;
}): React.ReactNode {
  return (
    <MenuRadioItem closeOnClick value={modelChoiceKey(option)}>
      <span className="flex min-w-0 flex-col">
        <span>{option.label}</span>
        {description ? <span className="text-muted-foreground text-xs">{description}</span> : null}
        {restartHint ? <span className="text-2xs text-label-tertiary">{restartHint}</span> : null}
      </span>
    </MenuRadioItem>
  );
}

export function ModelSelectorMenu({
  disabled,
  harness,
  selectableHarnesses,
  runtimeCues,
  modelOptions,
  effortOptions,
  selectedModelId,
  selectedAccountId,
  accountSwitchRestarts = false,
  selectedEffortId,
  onSelectModel,
  onSelectEffort,
  onResetModel,
  onResetEffort,
  onSelectHarness,
}: {
  disabled: boolean;
  harness?: AgentKind;
  /** Harnesses offered for selection; absent/empty when the session's harness is fixed. */
  selectableHarnesses?: AgentKind[];
  /** Runtime availability per harness: a cue renders as a muted badge on the submenu item. */
  runtimeCues?: AgentRuntimeCues;
  modelOptions?: ModelOption[];
  effortOptions?: EffortOption[];
  selectedModelId: string | null;
  /** Disambiguates the selection when the list spans accounts serving the same model id. */
  selectedAccountId?: string;
  /** Live sessions only: credentials are injected at spawn, so leaving `selectedAccountId` relaunches
   * the agent. Entries from another account say so; a draft has nothing to restart. */
  accountSwitchRestarts?: boolean;
  selectedEffortId: EffortLevel | null;
  /** Carries the whole entry: a cross-account list needs the account alongside the id. */
  onSelectModel: (model: ModelOption) => void;
  onSelectEffort: (effort: EffortLevel) => void;
  /** Draft-only escape hatch back to the harness/configured model default. */
  onResetModel?: () => void;
  /** Draft-only escape hatch back to the harness effort default. */
  onResetEffort?: () => void;
  onSelectHarness?: (harness: AgentKind) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.composer');
  const selectedModel = resolveModel(modelOptions, selectedModelId, selectedAccountId);
  const providerGroups = groupModelsByProvider(modelOptions);
  const restartHintFor = (option: ModelOption): string | undefined =>
    accountSwitchRestarts && switchesAccount(option, selectedAccountId)
      ? t('modelSwitchRestarts')
      : undefined;
  const selectedEffort =
    optionById(effortOptions, selectedEffortId) ??
    (selectedEffortId ? EFFORT_OPTIONS_BY_ID[selectedEffortId] : undefined);
  const harnesses = selectableHarnesses ?? [];
  const hasEfforts = Boolean(effortOptions?.length);
  const hasModels = Boolean(modelOptions?.length);
  const modelLabel = selectedModel?.label ?? selectedModelId ?? t('modelDefault');
  const effortLabel = selectedEffort?.label ?? t('effortDefault');
  // A draft harness picker must keep the model axis visible even when that harness discovers
  // its concrete model only after session start (OpenCode/Pi). The live update replaces Default.
  const showsModel = harnesses.length > 0 || hasModels || selectedModelId !== null;

  if (!hasEfforts && !showsModel && harnesses.length === 0) return null;
  // A single remaining harness (restricted build, CODE-618, or otherwise) is nothing to pick
  // between — the picker must disappear rather than offer a menu with one inert entry.
  const showsHarnessPicker = harnesses.length > 1;
  const selectorLabels: string[] = [];
  if (harness) selectorLabels.push(AGENT_LABELS[harness]);
  if (showsModel) selectorLabels.push(modelLabel);
  if (hasEfforts) selectorLabels.push(`${t('effort')}: ${effortLabel}`);

  return (
    <Menu>
      <MenuTrigger
        aria-label={selectorLabels.join(', ')}
        disabled={disabled}
        render={<Button className="shrink-0" size="sm" type="button" variant="ghost" />}
      >
        {harness && showsHarnessPicker ? <AgentIcon kind={harness} variant="brand" /> : null}
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
        <ChevronDownIcon className="size-3 text-label-tertiary" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-56" side="top" sideOffset={8}>
        {onSelectHarness && showsHarnessPicker ? (
          <MenuSub>
            <MenuSubTrigger>
              <span>{t('harness')}</span>
              <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-muted-foreground">
                {harness ? <AgentIcon kind={harness} variant="brand" /> : null}
                <span className="truncate">
                  {harness ? AGENT_LABELS[harness] : t('modelDefault')}
                </span>
              </span>
            </MenuSubTrigger>
            <MenuSubPopup className="w-60">
              <MenuRadioGroup
                value={harness ?? ''}
                onValueChange={(value) => onSelectHarness(value as AgentKind)}
              >
                {harnesses.map((kind) => (
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
        {hasModels ? (
          <MenuSub>
            <MenuSubTrigger>
              <span>{t('model')}</span>
              <span className="min-w-0 flex-1 truncate text-end text-muted-foreground">
                {modelLabel}
              </span>
            </MenuSubTrigger>
            <MenuSubPopup className="w-56">
              <MenuRadioGroup
                value={selectedModel === undefined ? '' : modelChoiceKey(selectedModel)}
                onValueChange={(value) => {
                  // Keyed by (account, model), so map back to the entry rather than parsing it.
                  const picked = modelOptions?.find(
                    (option) => modelChoiceKey(option) === String(value),
                  );
                  if (picked) onSelectModel(picked);
                }}
              >
                {providerGroups === null ? (
                  modelOptions?.map((option) => (
                    <ModelMenuItem
                      key={modelChoiceKey(option)}
                      description={option.description}
                      option={option}
                      restartHint={restartHintFor(option)}
                    />
                  ))
                ) : (
                  <>
                    {providerGroups.ungrouped.map((option) => (
                      <ModelMenuItem
                        key={modelChoiceKey(option)}
                        option={option}
                        restartHint={restartHintFor(option)}
                      />
                    ))}
                    {/* One submenu per provider; the trigger names the provider, so items drop
                     * the subtitle the flat list needs for disambiguation. */}
                    {providerGroups.groups.map((group) => (
                      <MenuSub key={group.label}>
                        <MenuSubTrigger>{group.label}</MenuSubTrigger>
                        <MenuSubPopup className="w-56">
                          {group.options.map((option) => (
                            <ModelMenuItem
                              key={modelChoiceKey(option)}
                              option={option}
                              restartHint={restartHintFor(option)}
                            />
                          ))}
                        </MenuSubPopup>
                      </MenuSub>
                    ))}
                  </>
                )}
              </MenuRadioGroup>
            </MenuSubPopup>
          </MenuSub>
        ) : null}
        {hasEfforts ? (
          <MenuSub>
            <MenuSubTrigger>
              <span>{t('effort')}</span>
              <span className="min-w-0 flex-1 truncate text-end text-muted-foreground">
                {effortLabel}
              </span>
            </MenuSubTrigger>
            <MenuSubPopup className="w-56">
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
            </MenuSubPopup>
          </MenuSub>
        ) : null}
        {onResetModel || onResetEffort ? (
          <>
            <MenuSeparator />
            <MenuItem
              onClick={() => {
                onResetModel?.();
                onResetEffort?.();
              }}
            >
              {t('resetToDefault')}
              <span className="ms-auto flex">
                <RotateCcwIcon aria-hidden className="size-4 opacity-80" />
              </span>
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
