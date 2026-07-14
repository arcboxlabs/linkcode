import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Form } from 'coss-ui/components/form';
import {
  Frame,
  FrameDescription,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from 'coss-ui/components/frame';
import { InputPrimitive } from 'coss-ui/components/input';
import { Tooltip, TooltipContent, TooltipTrigger } from 'coss-ui/components/tooltip';
import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon, PencilIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import type {
  ConversationPromptChoice,
  ConversationPromptMode,
  ConversationPromptResponse,
  ConversationPromptTone,
} from './conversation-prompt';
import { isConversationPromptResponseSubmittable } from './conversation-prompt';
import { choiceIndexForNumberShortcut } from './conversation-prompt-keyboard';

const EMPTY_DETAILS: ConversationPromptDetail[] = [];

export interface ConversationPromptDetail {
  label: string;
  value: string;
  monospace?: boolean;
}

export interface ConversationPromptAlertProps {
  className?: string;
  title: React.ReactNode;
  badge?: string;
  tone?: ConversationPromptTone;
  details?: readonly ConversationPromptDetail[];
  mode: ConversationPromptMode;
  choices: readonly ConversationPromptChoice[];
  submitting?: boolean;
  action?: React.ReactNode;
  footerAction?: React.ReactNode;
  autoFocusFirstChoice?: boolean;
  customInputDisabled?: boolean;
  customInputPlaceholder?: string;
  response?: ConversationPromptResponse;
  submitLabel?: string;
  skipLabel?: string;
  onResponseChange?: (response: ConversationPromptResponse) => void;
  onSubmit?: (response: ConversationPromptResponse) => void;
  onSkip?: () => void;
}

export function ConversationPromptAlert({
  className,
  title,
  badge,
  tone = 'neutral',
  details = EMPTY_DETAILS,
  mode,
  choices,
  submitting = false,
  action,
  footerAction,
  autoFocusFirstChoice = false,
  customInputDisabled = false,
  customInputPlaceholder,
  response: controlledResponse,
  submitLabel,
  skipLabel,
  onResponseChange,
  onSubmit,
  onSkip,
}: ConversationPromptAlertProps): React.ReactNode {
  const t = useTranslations('workbench.prompt');
  const titleId = useId();
  const [uncontrolledResponse, setUncontrolledResponse] = useState<ConversationPromptResponse>({
    selectedIds: [],
  });
  const [customTextDraft, setCustomTextDraft] = useState(
    () => controlledResponse?.customText ?? '',
  );
  const currentResponse = controlledResponse ?? uncontrolledResponse;
  const customSelected = currentResponse.customText !== undefined;
  const customText = customSelected ? (currentResponse.customText ?? '') : customTextDraft;

  // Filter controlled or local drafts against current props so page changes need no sync effect.
  const choiceIds = new Set(choices.map((choice) => choice.id));
  const validSelectedIds = currentResponse.selectedIds.filter((id) => choiceIds.has(id));
  const effectiveSelectedIds = customSelected
    ? []
    : mode === 'multiple'
      ? validSelectedIds
      : validSelectedIds.slice(0, 1);

  const response: ConversationPromptResponse = customSelected
    ? {
        selectedIds: [],
        customText,
      }
    : {
        selectedIds: effectiveSelectedIds,
      };
  const canSubmit =
    Boolean(onSubmit) &&
    !submitting &&
    isConversationPromptResponseSubmittable({ mode, choices }, response);
  const showSubmit = Boolean(onSubmit) && (mode === 'multiple' || customSelected);

  function updateResponse(nextResponse: ConversationPromptResponse): void {
    if (controlledResponse === undefined) setUncontrolledResponse(nextResponse);
    onResponseChange?.(nextResponse);
  }

  function selectChoice(choiceId: string): void {
    if (submitting) return;
    if (mode === 'single') {
      const nextResponse = { selectedIds: [choiceId] };
      updateResponse(nextResponse);
      onSubmit?.(nextResponse);
      return;
    }

    updateResponse({
      selectedIds: effectiveSelectedIds.includes(choiceId)
        ? effectiveSelectedIds.filter((id) => id !== choiceId)
        : [...effectiveSelectedIds, choiceId],
    });
  }

  function selectCustom(): void {
    if (customInputDisabled) return;
    updateResponse({ selectedIds: [], customText });
  }

  function setCustomResponse(value: string): void {
    setCustomTextDraft(value);
    updateResponse({ selectedIds: [], customText: value });
  }

  function submit(): void {
    if (!canSubmit || !onSubmit) return;
    onSubmit({
      selectedIds: effectiveSelectedIds,
      customText: customSelected ? customText.trim() || undefined : undefined,
    });
  }

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLFormElement>): void {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.key === 'Process') {
      return;
    }

    const hasCommandModifier = event.metaKey || event.ctrlKey || event.altKey;
    if (event.key === 'Enter' && (event.repeat || event.shiftKey || hasCommandModifier)) {
      event.preventDefault();
      return;
    }
    if (hasCommandModifier || isEditableTarget(event.target)) return;

    const numberIndex = choiceIndexForNumberShortcut(event.code, event.key);
    if (!event.repeat && numberIndex !== null && numberIndex < choices.length) {
      event.preventDefault();
      activateChoiceAt(numberIndex, event.currentTarget);
      return;
    }

    if (event.shiftKey || (event.repeat && event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
      return;
    }

    if (
      onSubmit &&
      event.key === 'Enter' &&
      mode === 'multiple' &&
      isPromptChoiceTarget(event.target)
    ) {
      const focusedIndex = focusedChoiceIndex(event.currentTarget);
      if (focusedIndex !== null && effectiveSelectedIds.includes(choices[focusedIndex].id)) {
        event.preventDefault();
        submit();
      }
      return;
    }

    if (choices.length === 0 || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) {
      return;
    }

    event.preventDefault();
    const focusedIndex = focusedChoiceIndex(event.currentTarget);
    const currentIndex = focusedIndex ?? currentChoiceIndex(choices, effectiveSelectedIds);
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex =
      currentIndex === null
        ? event.key === 'ArrowDown'
          ? 0
          : choices.length - 1
        : wrapIndex(currentIndex + offset, choices.length);
    focusChoiceAt(nextIndex, event.currentTarget);
  }

  function activateChoiceAt(index: number, form: HTMLFormElement): void {
    if (index < 0 || index >= choices.length) return;
    const choice = choices[index];

    focusChoiceAt(index, form);
    selectChoice(choice.id);
  }

  return (
    <Frame className={cn('my-0', className)}>
      <Form className="flex flex-col" onKeyDown={handleKeyDown} onSubmit={handleSubmit}>
        <FrameHeader className="gap-1 px-3 py-2">
          <div className="flex w-full min-w-0 items-center justify-between gap-2">
            <FrameTitle id={titleId} className="flex min-w-0 items-center gap-2 font-medium">
              <span className="min-w-0 truncate">{title}</span>
              {badge ? (
                <Badge size="sm" variant={badgeVariantForTone(tone)}>
                  {badge}
                </Badge>
              ) : null}
            </FrameTitle>
            {action ? <div className="shrink-0">{action}</div> : null}
          </div>
          {details.length > 0 ? (
            <FrameDescription>
              <PromptDetails details={details} />
            </FrameDescription>
          ) : null}
        </FrameHeader>
        <FramePanel aria-labelledby={titleId} className="p-1" role="group">
          <PromptChoices
            autoFocusFirstChoice={autoFocusFirstChoice}
            choices={choices}
            customInputDisabled={customInputDisabled}
            customInputPlaceholder={customInputPlaceholder ?? t('customPlaceholder')}
            customSelected={customSelected}
            customText={customText}
            disabled={submitting}
            mode={mode}
            selectedIds={effectiveSelectedIds}
            onCustomSelect={selectCustom}
            onCustomTextChange={setCustomResponse}
            onSelectChoice={selectChoice}
          />
        </FramePanel>
        {onSkip || showSubmit || footerAction ? (
          <FrameFooter className="flex items-center justify-end gap-1 px-2 py-1.5">
            {onSkip ? (
              <Button
                disabled={submitting}
                size="xs"
                type="button"
                variant="ghost"
                onClick={onSkip}
              >
                {skipLabel ?? t('skip')}
              </Button>
            ) : null}
            {showSubmit ? (
              <Button disabled={!canSubmit} loading={submitting} size="xs" type="submit">
                {submitLabel ?? t('submit')}
                <CornerDownLeftIcon />
              </Button>
            ) : null}
            {footerAction}
          </FrameFooter>
        ) : null}
      </Form>
    </Frame>
  );
}

function PromptDetails({ details }: { details: readonly ConversationPromptDetail[] }) {
  return (
    <div className="min-w-0 space-y-0.5">
      {details.map((detail) => (
        <div key={`${detail.label}:${detail.value}`} className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-muted-foreground text-xs">{detail.label}</span>
          <span
            className={cn(
              'min-w-0 truncate text-foreground text-xs',
              detail.monospace && 'font-mono',
            )}
          >
            {detail.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function PromptChoices({
  autoFocusFirstChoice,
  choices,
  customInputDisabled,
  customInputPlaceholder,
  customSelected,
  customText,
  disabled,
  mode,
  selectedIds,
  onCustomSelect,
  onCustomTextChange,
  onSelectChoice,
}: {
  autoFocusFirstChoice: boolean;
  choices: readonly ConversationPromptChoice[];
  customInputDisabled: boolean;
  customInputPlaceholder: string;
  customSelected: boolean;
  customText: string;
  disabled: boolean;
  mode: ConversationPromptMode;
  selectedIds: readonly string[];
  onCustomSelect: () => void;
  onCustomTextChange: (value: string) => void;
  onSelectChoice: (choiceId: string) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-0.5">
      {choices.map((choice, index) => {
        const selected = selectedIds.includes(choice.id);
        return (
          <PromptChoiceRow
            key={choice.id}
            autoFocus={autoFocusFirstChoice && index === 0}
            checked={selected}
            choice={choice}
            disabled={disabled}
            index={index}
            multiple={mode === 'multiple'}
            onSelect={() => onSelectChoice(choice.id)}
          />
        );
      })}
      <PromptCustomRow
        checked={customSelected}
        disabled={customInputDisabled || disabled}
        placeholder={customInputPlaceholder}
        value={customText}
        onSelect={onCustomSelect}
        onValueChange={onCustomTextChange}
      />
    </div>
  );
}

function PromptChoiceRow({
  autoFocus,
  checked,
  choice,
  disabled,
  index,
  multiple,
  onSelect,
}: {
  autoFocus: boolean;
  checked: boolean;
  choice: ConversationPromptChoice;
  disabled: boolean;
  index: number;
  multiple: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={cn(
        'w-full rounded-lg transition-colors',
        checked && 'bg-accent/50 text-accent-foreground',
        choice.tone === 'danger' && checked && 'bg-destructive/8',
      )}
    >
      <Button
        className="h-auto w-full justify-start whitespace-normal px-2 py-1.5 text-left"
        data-prompt-choice=""
        aria-pressed={multiple || checked ? checked : undefined}
        autoFocus={autoFocus}
        disabled={disabled}
        type="button"
        variant="ghost"
        onClick={onSelect}
      >
        <span
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-full border border-input bg-background text-muted-foreground',
            checked && 'border-foreground bg-foreground text-background',
          )}
        >
          <span className="text-xs tabular-nums">{index + 1}</span>
        </span>
        <span className="min-w-0 flex-1 flex items-center gap-2 text-left">
          <span
            className={cn(
              'block font-medium text-foreground text-sm',
              choice.tone === 'danger' && 'text-destructive-foreground',
            )}
          >
            {choice.label}
          </span>
          {choice.description ? (
            <Tooltip>
              <TooltipTrigger
                delay={300}
                render={
                  <span className="block truncate text-muted-foreground text-xs">
                    {choice.description}
                  </span>
                }
              />
              <TooltipContent className="max-w-xl">{choice.description}</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
        {checked ? (
          <span className="ms-auto flex shrink-0 items-center gap-1 text-muted-foreground">
            <ArrowUpIcon className="size-3.5" />
            <ArrowDownIcon className="size-3.5" />
          </span>
        ) : null}
      </Button>
    </div>
  );
}

function PromptCustomRow({
  checked,
  disabled,
  placeholder,
  value,
  onSelect,
  onValueChange,
}: {
  checked: boolean;
  disabled: boolean;
  placeholder: string;
  value: string;
  onSelect: () => void;
  onValueChange: (value: string) => void;
}) {
  return (
    <div
      className={cn(
        'w-full rounded-lg transition-colors focus-within:bg-accent/50',
        checked && 'bg-accent/50 text-accent-foreground',
      )}
    >
      <div className="flex h-auto w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left">
        <span
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-full border border-input bg-background text-muted-foreground',
            checked && 'border-foreground bg-foreground text-background',
          )}
        >
          <PencilIcon className="size-3" />
        </span>
        <InputPrimitive
          aria-label={placeholder}
          className="h-5 min-w-0 flex-1 bg-transparent p-0 font-medium text-foreground text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:text-muted-foreground disabled:placeholder:text-muted-foreground/72"
          disabled={disabled}
          placeholder={placeholder}
          title={placeholder}
          value={value}
          onFocus={onSelect}
          onChange={(event) => onValueChange(event.currentTarget.value)}
        />
      </div>
    </div>
  );
}

function badgeVariantForTone(
  tone: ConversationPromptTone,
): React.ComponentProps<typeof Badge>['variant'] {
  if (tone === 'danger') return 'error';
  if (tone === 'warning') return 'warning';
  return 'secondary';
}

function currentChoiceIndex(
  choices: readonly ConversationPromptChoice[],
  selectedIds: readonly string[],
): number | null {
  const selectedId = selectedIds[0];
  for (let index = 0; index < choices.length; index += 1) {
    if (choices[index].id === selectedId) return index;
  }
  return null;
}

function wrapIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return (index + length) % length;
}

function focusedChoiceIndex(form: HTMLFormElement): number | null {
  const choices = form.querySelectorAll<HTMLElement>('[data-prompt-choice]');
  for (let index = 0; index < choices.length; index += 1) {
    if (choices[index] === document.activeElement) return index;
  }
  return null;
}

function focusChoiceAt(index: number, form: HTMLFormElement): void {
  const choices = form.querySelectorAll<HTMLElement>('[data-prompt-choice]');
  if (index < 0 || index >= choices.length) return;
  choices[index].focus();
}

function isPromptChoiceTarget(target: EventTarget): boolean {
  return target instanceof HTMLElement && target.closest('[data-prompt-choice]') !== null;
}

function isEditableTarget(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !==
      null
  );
}
