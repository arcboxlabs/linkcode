import type { Question, QuestionAnswer, QuestionOutcome } from '@linkcode/schema';
import { Button, Input, Spinner, TextField } from 'heroui-native';
import { Check, X } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { useTranslations } from 'use-intl';

export interface QuestionPromptProps {
  questions: Question[];
  responding: boolean;
  onRespond: (outcome: QuestionOutcome) => void;
}

interface Draft {
  selected: string[];
  customText: string;
}

/**
 * One agent question batch pages within its card (desktop `question-prompt.tsx`):
 * radio vs checkbox per `multiSelect`, optional free-text answer, single-select
 * auto-advances, the whole batch resolves as one `QuestionOutcome`.
 */
export function QuestionPrompt({
  questions,
  responding,
  onRespond,
}: QuestionPromptProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const mutedColor = useCSSVariable('--muted');

  const question = questions[Math.min(index, questions.length - 1)];
  const draft = drafts[question.questionId] ?? { selected: [], customText: '' };
  const isLast = index >= questions.length - 1;

  const setDraft = (next: Draft): void => {
    setDrafts((current) => ({ ...current, [question.questionId]: next }));
  };

  const buildAnswers = (finalDraft: Draft): QuestionAnswer[] =>
    questions.map((q) => {
      const d =
        q.questionId === question.questionId
          ? finalDraft
          : (drafts[q.questionId] ?? { selected: [], customText: '' });
      const customText = d.customText.trim();
      return {
        questionId: q.questionId,
        selectedOptionIds: d.selected,
        ...(customText.length > 0 && { customText }),
      };
    });

  const advanceOrSubmit = (finalDraft: Draft): void => {
    if (isLast) {
      onRespond({ outcome: 'answered', answers: buildAnswers(finalDraft) });
    } else {
      setIndex((current) => current + 1);
    }
  };

  const toggleOption = (optionId: string): void => {
    if (question.multiSelect) {
      const selected = draft.selected.includes(optionId)
        ? draft.selected.filter((id) => id !== optionId)
        : [...draft.selected, optionId];
      setDraft({ ...draft, selected });
      return;
    }
    const next = { ...draft, selected: [optionId] };
    setDraft(next);
    advanceOrSubmit(next);
  };

  const answered = draft.selected.length > 0 || draft.customText.trim().length > 0;

  return (
    <View className="rounded-xl border border-border bg-background">
      <View className="flex-row items-center gap-2 px-3.5 pt-3 pb-1">
        {question.header ? (
          <View className="rounded-md bg-surface-secondary px-2 py-0.5">
            <Text
              className="text-[10px] text-muted"
              style={{ fontWeight: '600', letterSpacing: 0.4 }}
            >
              {question.header}
            </Text>
          </View>
        ) : null}
        <Text className="flex-1 text-[14px] text-foreground" style={{ fontWeight: '600' }}>
          {question.prompt}
        </Text>
        {questions.length > 1 ? (
          <Text className="text-[11px] text-muted">
            {t('questionProgress', { current: index + 1, total: questions.length })}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('skip')}
          disabled={responding}
          onPress={() => onRespond({ outcome: 'cancelled' })}
          className="size-8 items-center justify-center"
        >
          <X size={15} color={String(mutedColor)} />
        </Pressable>
      </View>
      <View className="mt-1">
        {question.options.map((option, optionIndex) => {
          const selected = draft.selected.includes(option.optionId);
          return (
            <Pressable
              key={option.optionId}
              accessibilityRole={question.multiSelect ? 'checkbox' : 'radio'}
              accessibilityState={{ checked: selected }}
              disabled={responding}
              onPress={() => toggleOption(option.optionId)}
              className="min-h-11 flex-row items-center gap-2.5 border-border border-t px-3.5 py-2"
            >
              <View
                className={`size-5 items-center justify-center rounded-full border ${
                  selected ? 'border-accent bg-accent' : 'border-border'
                }`}
              >
                {selected ? (
                  <Check size={12} color="white" />
                ) : (
                  <Text className="text-[10.5px] text-foreground" style={{ fontWeight: '600' }}>
                    {optionIndex + 1}
                  </Text>
                )}
              </View>
              <View className="flex-1">
                <Text className="text-[13px] text-foreground" style={{ fontWeight: '500' }}>
                  {option.label}
                </Text>
                {option.description ? (
                  <Text className="text-[11.5px] text-muted" numberOfLines={2}>
                    {option.description}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      <View className="gap-2 border-border border-t px-3.5 py-2.5">
        <TextField>
          <Input
            placeholder={t('customAnswerPlaceholder')}
            value={draft.customText}
            editable={!responding}
            onChangeText={(text) => setDraft({ ...draft, customText: text })}
          />
        </TextField>
        {question.multiSelect || draft.customText.trim() ? (
          <Button
            size="sm"
            isDisabled={responding || !answered}
            onPress={() => advanceOrSubmit(draft)}
          >
            {responding ? <Spinner size="sm" color="default" /> : null}
            <Button.Label>{isLast ? t('submitAnswers') : t('next')}</Button.Label>
          </Button>
        ) : null}
      </View>
    </View>
  );
}
