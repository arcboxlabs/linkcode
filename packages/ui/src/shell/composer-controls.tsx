import type { AgentKind, ApprovalPolicy, EffortLevel, SessionMode } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
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
  ShieldIcon,
  SlidersHorizontalIcon,
  TargetIcon,
} from 'lucide-react';
import { useTranslations } from 'use-intl';
import { AGENT_LABELS, AgentIcon } from '../chat/agent-icon';
import type { EffortOption } from './agent-efforts';
import type { ModelOption } from './agent-models';

// Linear lookup: the policy/model/effort lists are a handful of entries at most.
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
          <Button className="text-muted-foreground" size="sm" type="button" variant="ghost" />
        }
      >
        <ShieldIcon />
        {active.name}
        <ChevronDownIcon className="size-3 text-muted-foreground/72" />
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
        type="button"
        variant="ghost"
      >
        <Icon />
        {mode.name}
      </Button>
    </>
  );
}

/** Codex-style model trigger: [provider glyph] model + effort, opening reasoning/model/provider menus. */
export function ModelSelectorMenu({
  disabled,
  provider,
  selectableProviders,
  modelOptions,
  effortOptions,
  selectedModelId,
  selectedEffortId,
  onSelectModel,
  onSelectEffort,
  onSelectProvider,
}: {
  disabled: boolean;
  provider?: AgentKind;
  /** Providers offered for selection; absent/empty when the session's provider is fixed. */
  selectableProviders?: AgentKind[];
  modelOptions?: ModelOption[];
  effortOptions?: EffortOption[];
  selectedModelId: string | null;
  selectedEffortId: EffortLevel | null;
  onSelectModel: (model: string) => void;
  onSelectEffort: (effort: EffortLevel) => void;
  onSelectProvider?: (provider: AgentKind) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.composer');
  const selectedModel = optionById(modelOptions, selectedModelId);
  const selectedEffort = optionById(effortOptions, selectedEffortId);
  const providers = selectableProviders ?? [];
  const hasEfforts = Boolean(effortOptions?.length);
  const hasModels = Boolean(modelOptions?.length);

  if (!hasEfforts && !hasModels && providers.length === 0) return null;

  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        render={<Button className="shrink-0" size="sm" type="button" variant="ghost" />}
      >
        {providers.length > 0 && provider ? (
          <AgentIcon className="text-muted-foreground" kind={provider} variant="ghost" />
        ) : null}
        {hasModels ? (selectedModel?.label ?? t('modelDefault')) : null}
        {hasEfforts ? (
          <span className="font-normal text-muted-foreground">
            {selectedEffort?.label ?? t('effortDefault')}
          </span>
        ) : null}
        <ChevronDownIcon className="size-3 text-muted-foreground/72" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-56" side="top" sideOffset={8}>
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
              <MenuSubTrigger>{selectedModel?.label ?? t('modelDefault')}</MenuSubTrigger>
              <MenuSubPopup className="w-56">
                <MenuRadioGroup
                  value={selectedModelId ?? ''}
                  onValueChange={(value) => onSelectModel(String(value))}
                >
                  {modelOptions?.map((option) => (
                    <MenuRadioItem key={option.id} closeOnClick value={option.id}>
                      {option.label}
                    </MenuRadioItem>
                  ))}
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
                  <AgentIcon kind={provider} variant="ghost" />
                  {AGENT_LABELS[provider]}
                </>
              ) : (
                t('provider')
              )}
            </MenuSubTrigger>
            <MenuSubPopup className="w-48">
              <MenuRadioGroup
                value={provider ?? ''}
                onValueChange={(value) => onSelectProvider(value as AgentKind)}
              >
                {providers.map((kind) => (
                  <MenuRadioItem key={kind} closeOnClick value={kind}>
                    <span className="flex items-center gap-2">
                      <AgentIcon kind={kind} variant="ghost" />
                      {AGENT_LABELS[kind]}
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
