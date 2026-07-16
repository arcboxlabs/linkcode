import { Button } from 'coss-ui/components/button';
import { Checkbox } from 'coss-ui/components/checkbox';
import { CheckboxGroup } from 'coss-ui/components/checkbox-group';
import { InputPrimitive } from 'coss-ui/components/input';
import { Kbd } from 'coss-ui/components/kbd';
import { Radio, RadioGroup } from 'coss-ui/components/radio-group';
import { Tooltip, TooltipContent, TooltipTrigger } from 'coss-ui/components/tooltip';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { falseFn, noop } from 'foxts/noop';
import { PencilIcon } from 'lucide-react';
import { useCallback, useRef, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import type { QuestionConversationItem } from '../chat/conversation-prompts';
import { cn } from '../lib/cn';

export interface QuestionDraft {
  selectedIds: string[];
  customText?: string;
}

export function QuestionChoices({
  autoFocus,
  customDraft,
  disabled,
  question,
  response,
  onCustomTextChange,
  onResponseChange,
}: {
  autoFocus: boolean;
  customDraft: string;
  disabled: boolean;
  question: QuestionConversationItem['questions'][number];
  response: QuestionDraft;
  onCustomTextChange: (value: string) => void;
  onResponseChange: (response: QuestionDraft) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.question');
  const customSelected = response.customText !== undefined;
  const values = customSelected ? [] : response.selectedIds;

  function selectCustom(): void {
    onResponseChange({ selectedIds: [], customText: customDraft });
  }

  function selectStructured(selectedIds: string[]): void {
    onResponseChange({ selectedIds });
  }

  const choices = question.options.map((option, optionIndex) => (
    <ChoiceRow
      key={option.optionId}
      autoFocus={autoFocus && optionIndex === 0}
      checked={response.selectedIds.includes(option.optionId)}
      description={option.description}
      disabled={disabled}
      index={optionIndex}
      label={option.label}
      name={question.questionId}
      type={question.multiSelect ? 'checkbox' : 'radio'}
      value={option.optionId}
    />
  ));

  return (
    // Bleeds the rows' own px-2 into the panel padding so keycaps align with the title.
    <div className="-mx-2 flex flex-col gap-0.5">
      {question.multiSelect ? (
        <CheckboxGroup
          aria-label={question.prompt}
          className="w-full gap-0.5"
          disabled={disabled}
          value={values}
          onValueChange={selectStructured}
        >
          {choices}
        </CheckboxGroup>
      ) : (
        <RadioGroup
          aria-label={question.prompt}
          className="w-full gap-0.5"
          disabled={disabled}
          name={question.questionId}
          value={customSelected ? '' : (response.selectedIds[0] ?? '')}
          onValueChange={(value) => {
            selectStructured([value]);
          }}
        >
          {choices}
        </RadioGroup>
      )}
      <CustomChoiceRow
        checked={customSelected}
        disabled={disabled}
        placeholder={t('customPlaceholder')}
        value={customDraft}
        onSelect={selectCustom}
        onValueChange={onCustomTextChange}
      />
    </div>
  );
}

export function isQuestionAnswered(
  question: QuestionConversationItem['questions'][number],
  response: QuestionDraft,
): boolean {
  if (response.customText !== undefined) {
    return response.selectedIds.length === 0 && response.customText.trim().length > 0;
  }
  const optionIds = new Set(question.options.map((option) => option.optionId));
  if (!response.selectedIds.every((optionId) => optionIds.has(optionId))) return false;
  return question.multiSelect ? response.selectedIds.length > 0 : response.selectedIds.length === 1;
}

function ChoiceRow({
  autoFocus,
  checked,
  description,
  disabled,
  index,
  label,
  name,
  type,
  value,
}: {
  autoFocus: boolean;
  checked: boolean;
  description?: string;
  disabled: boolean;
  index: number;
  label: string;
  name: string;
  type: 'checkbox' | 'radio';
  value: string;
}): React.ReactNode {
  const choiceRef = useRef<HTMLSpanElement>(null);
  const descriptionRef = useRef<HTMLSpanElement>(null);
  const subscribeToDescriptionSize = useCallback((onChange: () => void): (() => void) => {
    const element = descriptionRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return noop;
    const observer = new ResizeObserver(onChange);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const readDescriptionOverflow = useCallback((): boolean => {
    const element = descriptionRef.current;
    return element ? element.scrollWidth > element.clientWidth : false;
  }, []);
  const descriptionOverflowing = useSyncExternalStore(
    subscribeToDescriptionSize,
    readDescriptionOverflow,
    falseFn,
  );

  useLayoutEffect(() => {
    if (autoFocus && !disabled) choiceRef.current?.focus();
  }, [autoFocus, disabled]);

  const row = (
    <label
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background',
        checked && 'bg-accent text-accent-foreground',
        disabled ? 'cursor-not-allowed opacity-64' : 'cursor-pointer hover:bg-accent/50',
      )}
    >
      <span className="relative flex size-6 shrink-0">
        <Kbd
          className={cn(
            'size-6 min-w-6 rounded-full border bg-background px-0 tabular-nums',
            checked && 'border-primary bg-primary text-primary-foreground',
          )}
        >
          {index + 1}
        </Kbd>
        {type === 'checkbox' ? (
          <Checkbox
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            data-prompt-choice=""
            name={name}
            ref={choiceRef}
            value={value}
          />
        ) : (
          <Radio
            className="absolute inset-0 size-full cursor-pointer opacity-0"
            data-prompt-choice=""
            ref={choiceRef}
            value={value}
          />
        )}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
        <span className="shrink-0 font-medium text-sm">{label}</span>
        {description ? (
          <span
            className="min-w-0 flex-1 truncate text-muted-foreground text-xs"
            ref={descriptionRef}
          >
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );

  if (!description) return row;
  return (
    <Tooltip disabled={!descriptionOverflowing}>
      <TooltipTrigger delay={0} render={row} />
      <TooltipContent
        align="start"
        anchor={descriptionRef}
        className="max-w-96 whitespace-normal text-left"
      >
        {description}
      </TooltipContent>
    </Tooltip>
  );
}

function CustomChoiceRow({
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
}): React.ReactNode {
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (checked && !disabled) inputRef.current?.focus();
  }, [checked, disabled]);

  const keycap = (
    <Kbd
      className={cn(
        'size-6 min-w-6 rounded-full border bg-background px-0',
        checked && 'border-primary bg-primary text-primary-foreground',
      )}
    >
      {/* explicit size so the ghost Button's [&_svg]:size-4 rule cannot inflate it past the digits */}
      <PencilIcon className="size-3" />
    </Kbd>
  );

  if (!checked) {
    return (
      <Button
        aria-label={placeholder}
        className="h-auto w-full justify-start gap-2.5 border-0 px-2 py-1.5 font-normal text-muted-foreground shadow-none sm:h-auto"
        disabled={disabled}
        variant="ghost"
        onClick={onSelect}
      >
        {keycap}
        <span className="min-w-0 truncate text-sm">{value || placeholder}</span>
      </Button>
    );
  }

  return (
    <div
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors focus-within:bg-accent/50 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background',
        'bg-accent text-accent-foreground',
        disabled && 'opacity-64',
      )}
    >
      {keycap}
      <InputPrimitive
        aria-label={placeholder}
        className="h-6 min-w-0 flex-1 bg-transparent p-0 text-sm outline-none placeholder:text-muted-foreground"
        disabled={disabled}
        placeholder={placeholder}
        ref={inputRef}
        value={value}
        onChange={(event) => onValueChange(event.currentTarget.value)}
      />
    </div>
  );
}
