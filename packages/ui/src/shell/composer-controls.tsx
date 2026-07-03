import type { AgentKind, EffortLevel } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import {
  Menu,
  MenuCheckboxItem,
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
  AtSignIcon,
  ChevronDownIcon,
  ListTodoIcon,
  PaperclipIcon,
  PlusIcon,
  ShieldIcon,
} from 'lucide-react';
import { useTranslations } from 'use-intl';
import type { EffortOption } from './agent-efforts';
import { AGENT_LABELS, AgentIcon } from './agent-icon';
import type { ModelOption } from './agent-models';
import type { ApprovalPolicyControl, PlanModeControl } from './session-modes';

// Linear lookup: the model/effort lists are a handful of entries at most.
function optionById<T extends { id: string }>(
  options: readonly T[] | undefined,
  id: string | null,
): T | undefined {
  for (const option of options ?? []) {
    if (option.id === id) return option;
  }
  return undefined;
}

/** The `+` menu gathering the composer's secondary operations (attach, mention, plan toggle). */
export function ComposerPlusMenu({
  disabled,
  plan,
  onInsertMention,
  finalFocus,
}: {
  disabled: boolean;
  /** The plan work-phase toggle; null when the agent doesn't advertise it (or modes are read-only). */
  plan: PlanModeControl | null;
  onInsertMention: () => void;
  /** Where focus lands after the menu closes — the composer textarea. */
  finalFocus: React.RefObject<HTMLTextAreaElement | null>;
}): React.ReactNode {
  const t = useTranslations('workbench.composer');

  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        render={
          <Button
            aria-label={t('add')}
            className="rounded-full text-muted-foreground"
            size="icon-sm"
            type="button"
            variant="ghost"
          />
        }
      >
        <PlusIcon />
      </MenuTrigger>
      <MenuPopup align="start" className="w-64" finalFocus={finalFocus} side="top" sideOffset={8}>
        <MenuItem disabled>
          <PaperclipIcon />
          {t('attach')}
        </MenuItem>
        <MenuItem onClick={onInsertMention}>
          <AtSignIcon />
          {t('mentions')}
        </MenuItem>
        {plan ? (
          <>
            <MenuSeparator />
            <MenuCheckboxItem checked={plan.active} closeOnClick onCheckedChange={plan.toggle}>
              <span className="flex min-w-0 flex-col">
                <span>{plan.mode.name}</span>
                {plan.mode.description ? (
                  <span className="text-muted-foreground text-xs">{plan.mode.description}</span>
                ) : null}
              </span>
            </MenuCheckboxItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

/** Codex-style approval policy picker: the agent's permission postures as a described radio list. */
export function ApprovalPolicyMenu({
  agentLabel,
  disabled,
  policy,
}: {
  agentLabel: string;
  disabled: boolean;
  policy: ApprovalPolicyControl;
}): React.ReactNode {
  const t = useTranslations('workbench.composer');

  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        render={
          <Button className="text-muted-foreground" size="sm" type="button" variant="ghost" />
        }
      >
        <ShieldIcon />
        {policy.active.name}
        <ChevronDownIcon className="size-3 text-muted-foreground/72" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-80" side="top" sideOffset={8}>
        <MenuGroup>
          <MenuGroupLabel>{t('approvalTitle', { agent: agentLabel })}</MenuGroupLabel>
          <MenuRadioGroup
            value={policy.active.modeId}
            onValueChange={(value) => policy.select(String(value))}
          >
            {policy.options.map((mode) => (
              <MenuRadioItem key={mode.modeId} className="py-1.5" closeOnClick value={mode.modeId}>
                <span className="flex min-w-0 flex-col">
                  <span>{mode.name}</span>
                  {mode.description ? (
                    <span className="text-muted-foreground text-xs">{mode.description}</span>
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

/** The `☰ Plan` chip shown while plan mode is on; clicking it restores the last approval policy. */
export function PlanModeChip({ plan }: { plan: PlanModeControl }): React.ReactNode {
  return (
    <>
      <Separator className="h-4" orientation="vertical" />
      <Button
        className="text-muted-foreground"
        onClick={plan.toggle}
        size="sm"
        type="button"
        variant="ghost"
      >
        <ListTodoIcon />
        {plan.mode.name}
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
            <MenuSubTrigger>{t('provider')}</MenuSubTrigger>
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
