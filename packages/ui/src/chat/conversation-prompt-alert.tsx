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
import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon, PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import type {
  ConversationPromptChoice,
  ConversationPromptMode,
  ConversationPromptResponse,
  ConversationPromptTone,
} from './conversation-prompt';
import { isConversationPromptResponseSubmittable } from './conversation-prompt';

const EMPTY_DETAILS: ConversationPromptDetail[] = [];
const NUMBER_KEY_PATTERN = /^[1-9]$/;

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
  customInputDisabled?: boolean;
  customInputPlaceholder?: string;
  submitLabel?: string;
  skipLabel?: string;
  onSubmit: (response: ConversationPromptResponse) => void;
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
  customInputDisabled = false,
  customInputPlaceholder,
  submitLabel,
  skipLabel,
  onSubmit,
  onSkip,
}: ConversationPromptAlertProps): React.ReactNode {
  const t = useTranslations('workbench.prompt');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customSelected, setCustomSelected] = useState(false);
  const [customText, setCustomText] = useState('');

  // Store only explicit user selection; derive the default first choice from current props.
  // That keeps prompt/page changes correct without a state-sync effect.
  const choiceIds = new Set(choices.map((choice) => choice.id));
  const validSelectedIds = selectedIds.filter((id) => choiceIds.has(id));
  const effectiveSelectedIds = customSelected
    ? []
    : mode === 'multiple'
      ? validSelectedIds
      : validSelectedIds.length > 0
        ? [validSelectedIds[0]]
        : choices.length > 0
          ? [choices[0].id]
          : [];

  const response: ConversationPromptResponse = customSelected
    ? {
        selectedIds: [],
        customText,
      }
    : {
        selectedIds: effectiveSelectedIds,
      };
  const canSubmit =
    !submitting && isConversationPromptResponseSubmittable({ mode, choices }, response);

  function selectChoice(choiceId: string): void {
    setCustomSelected(false);
    if (mode === 'multiple') {
      setSelectedIds((current) =>
        current.includes(choiceId)
          ? current.filter((id) => id !== choiceId)
          : [...current, choiceId],
      );
      return;
    }
    setSelectedIds([choiceId]);
  }

  function selectCustom(): void {
    if (customInputDisabled) return;
    setCustomSelected(true);
    setSelectedIds([]);
  }

  function setCustomResponse(value: string): void {
    setCustomText(value);
    if (value.length > 0) selectCustom();
  }

  function submit(): void {
    if (!canSubmit) return;
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
    // TODO(keyboard): these shortcuts only work while focus is inside the prompt. Move prompt
    // shortcuts into a global keyboard registry when the shell has one.
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;

    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      submit();
      return;
    }

    if (isEditableTarget(event.target)) return;

    const numberIndex = choiceIndexForNumberKey(event.key);
    if (numberIndex !== null && numberIndex < choices.length) {
      event.preventDefault();
      selectChoiceAt(numberIndex, event.currentTarget);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const focusedIndex = focusedChoiceIndex(event.currentTarget);
      const currentIndex = focusedIndex ?? currentChoiceIndex(choices, effectiveSelectedIds);
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = wrapIndex(currentIndex + offset, choices.length);
      // Multi-select arrows move focus only; number keys, Space/click, and submit keep their roles.
      if (mode === 'multiple') focusChoiceAt(nextIndex, event.currentTarget);
      else selectChoiceAt(nextIndex, event.currentTarget);
    }
  }

  function selectChoiceAt(index: number, form: HTMLFormElement): void {
    if (index < 0 || index >= choices.length) return;
    const choice = choices[index];

    selectChoice(choice.id);

    focusChoiceAt(index, form);
  }

  return (
    <Frame className={cn('my-0', className)}>
      <Form className="flex flex-col" onKeyDown={handleKeyDown} onSubmit={handleSubmit}>
        <FrameHeader className="gap-1 px-3 py-2">
          <div className="flex w-full min-w-0 items-center justify-between gap-2">
            <FrameTitle className="flex min-w-0 items-center gap-2 font-medium">
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
        <FramePanel className="p-1">
          <PromptChoices
            choices={choices}
            customInputDisabled={customInputDisabled}
            customInputPlaceholder={customInputPlaceholder ?? t('customPlaceholder')}
            customSelected={customSelected}
            customText={customText}
            selectedIds={effectiveSelectedIds}
            onCustomSelect={selectCustom}
            onCustomTextChange={setCustomResponse}
            onSelectChoice={selectChoice}
          />
        </FramePanel>
        <FrameFooter className="flex items-center justify-end gap-1 px-2 py-1.5">
          {onSkip ? (
            <Button disabled={submitting} size="xs" type="button" variant="ghost" onClick={onSkip}>
              {skipLabel ?? t('skip')}
            </Button>
          ) : null}
          <Button disabled={!canSubmit} loading={submitting} size="xs" type="submit">
            {submitLabel ?? t('submit')}
            <CornerDownLeftIcon />
          </Button>
        </FrameFooter>
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
  choices,
  customInputDisabled,
  customInputPlaceholder,
  customSelected,
  customText,
  selectedIds,
  onCustomSelect,
  onCustomTextChange,
  onSelectChoice,
}: {
  choices: readonly ConversationPromptChoice[];
  customInputDisabled: boolean;
  customInputPlaceholder: string;
  customSelected: boolean;
  customText: string;
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
            checked={selected}
            choice={choice}
            index={index}
            onSelect={() => onSelectChoice(choice.id)}
          />
        );
      })}
      <PromptCustomRow
        checked={customSelected}
        disabled={customInputDisabled}
        placeholder={customInputPlaceholder}
        value={customText}
        onSelect={onCustomSelect}
        onValueChange={onCustomTextChange}
      />
    </div>
  );
}

function PromptChoiceRow({
  checked,
  choice,
  index,
  onSelect,
}: {
  checked: boolean;
  choice: ConversationPromptChoice;
  index: number;
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
        aria-pressed={checked}
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
              'block truncate font-medium text-foreground text-sm',
              choice.tone === 'danger' && 'text-destructive-foreground',
            )}
          >
            {choice.label}
          </span>
          {choice.description ? (
            <span
              className="block truncate text-muted-foreground text-xs"
              title={choice.description}
            >
              {choice.description}
            </span>
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

function choiceIndexForNumberKey(key: string): number | null {
  if (!NUMBER_KEY_PATTERN.test(key)) return null;
  return Number(key) - 1;
}

function currentChoiceIndex(
  choices: readonly ConversationPromptChoice[],
  selectedIds: readonly string[],
): number {
  const selectedId = selectedIds[0];
  for (let index = 0; index < choices.length; index += 1) {
    if (choices[index].id === selectedId) return index;
  }
  return 0;
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

function isEditableTarget(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
  );
}
