import {
  Button,
  Host,
  HStack,
  Image,
  Spacer,
  Text,
  TextField,
  useNativeState,
  VStack,
} from '@expo/ui/swift-ui';
import {
  buttonStyle,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  onTapGesture,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import type { Question, QuestionAnswer, QuestionOutcome } from '@linkcode/schema';
import { useState } from 'react';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const TERTIARY = foregroundStyle({ type: 'hierarchical', style: 'tertiary' });
const WHOLE_ROW = contentShape(shapes.rectangle());

interface Draft {
  selected: string[];
  customText: string;
}

/**
 * One agent question batch pages within its card (desktop `question-prompt.tsx`): tappable
 * option rows draw their own checkmark, `multiSelect` toggles, single-select auto-advances,
 * an optional free-text answer, and the whole batch resolves as one `QuestionOutcome`.
 */
export function QuestionPrompt({
  questions,
  responding,
  onRespond,
}: {
  questions: Question[];
  responding: boolean;
  onRespond: (outcome: QuestionOutcome) => void;
}): React.ReactNode {
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const question = questions[Math.min(index, questions.length - 1)];
  const draft = drafts[question.questionId] ?? { selected: [], customText: '' };
  const isLast = index >= questions.length - 1;

  const setDraft = (next: Draft): void => {
    setDrafts((current) => ({ ...current, [question.questionId]: next }));
  };

  const buildAnswers = (finalDraft: Draft): QuestionAnswer[] =>
    questions.map((entry) => {
      const value =
        entry.questionId === question.questionId
          ? finalDraft
          : (drafts[entry.questionId] ?? { selected: [], customText: '' });
      const text = value.customText.trim();
      return {
        questionId: entry.questionId,
        selectedOptionIds: value.selected,
        ...(text.length > 0 && { customText: text }),
      };
    });

  const advanceOrSubmit = (finalDraft: Draft): void => {
    if (isLast) {
      onRespond({ outcome: 'answered', answers: buildAnswers(finalDraft) });
    } else {
      setDraft(finalDraft);
      setIndex((current) => current + 1);
    }
  };

  return (
    <QuestionPage
      key={`${question.questionId}:${draft.selected.join(',')}`}
      question={question}
      draft={draft}
      current={index + 1}
      total={questions.length}
      isLast={isLast}
      responding={responding}
      onDraftChange={setDraft}
      onAdvance={advanceOrSubmit}
      onCancel={() => onRespond({ outcome: 'cancelled' })}
    />
  );
}

function QuestionPage({
  question,
  draft,
  current,
  total,
  isLast,
  responding,
  onDraftChange,
  onAdvance,
  onCancel,
}: {
  question: Question;
  draft: Draft;
  current: number;
  total: number;
  isLast: boolean;
  responding: boolean;
  onDraftChange: (draft: Draft) => void;
  onAdvance: (draft: Draft) => void;
  onCancel: () => void;
}): React.ReactNode {
  const t = useTranslations('mobile.chat');
  // Each page owns a distinct native state. Remounting after a structured selection guarantees
  // that an asynchronous native write from the previous question/answer mode cannot leak here.
  const customText = useNativeState(draft.customText);

  const toggleOption = (optionId: string): void => {
    if (responding) return;
    const selected = question.multiSelect
      ? draft.selected.includes(optionId)
        ? draft.selected.filter((id) => id !== optionId)
        : [...draft.selected, optionId]
      : [optionId];
    const next = { selected, customText: '' };
    onDraftChange(next);
    if (!question.multiSelect) onAdvance(next);
  };

  const advance = (): void => {
    const text = customText.get().trim();
    onAdvance(text ? { selected: [], customText: text } : { ...draft, customText: '' });
  };

  return (
    <View className="rounded-xl border border-border bg-background px-3 py-2.5">
      <Host matchContents>
        <VStack alignment="leading" spacing={10}>
          <HStack spacing={8}>
            {question.header ? (
              <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), SECONDARY]}>
                {question.header}
              </Text>
            ) : null}
            <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' })]}>
              {question.prompt}
            </Text>
            <Spacer />
            {total > 1 ? (
              <Text modifiers={[font({ textStyle: 'caption' }), SECONDARY]}>
                {t('questionProgress', { current, total })}
              </Text>
            ) : null}
            <Image
              systemName="xmark"
              size={13}
              modifiers={[
                TERTIARY,
                WHOLE_ROW,
                onTapGesture(() => {
                  if (!responding) onCancel();
                }),
              ]}
            />
          </HStack>
          <VStack alignment="leading" spacing={2}>
            {question.options.map((option) => {
              const selected = draft.selected.includes(option.optionId);
              return (
                <HStack
                  key={option.optionId}
                  spacing={8}
                  modifiers={[WHOLE_ROW, onTapGesture(() => toggleOption(option.optionId))]}
                >
                  <Image
                    systemName={selected ? 'checkmark.circle.fill' : 'circle'}
                    size={16}
                    modifiers={selected ? [] : [TERTIARY]}
                  />
                  <VStack alignment="leading" spacing={1}>
                    <Text modifiers={[font({ textStyle: 'subheadline' })]}>{option.label}</Text>
                    {option.description ? (
                      <Text modifiers={[font({ textStyle: 'footnote' }), SECONDARY]}>
                        {option.description}
                      </Text>
                    ) : null}
                  </VStack>
                  <Spacer />
                </HStack>
              );
            })}
          </VStack>
          <TextField
            text={customText}
            placeholder={t('customAnswerPlaceholder')}
            onTextChange={(text) => {
              if (text.trim() && draft.selected.length > 0) {
                onDraftChange({ selected: [], customText: text });
              }
            }}
          />
          <Button
            label={isLast ? t('submitAnswers') : t('next')}
            onPress={advance}
            modifiers={[buttonStyle('borderedProminent'), disabled(responding)]}
          />
        </VStack>
      </Host>
    </View>
  );
}
