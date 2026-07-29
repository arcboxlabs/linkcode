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
  const t = useTranslations('mobile.chat');
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // SwiftUI TextField binds to shared native state; read back on submit.
  const customText = useNativeState('');

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
      customText.set('');
      setIndex((current) => current + 1);
    }
  };

  const withCustomText = (): Draft => ({ ...draft, customText: customText.get().trim() });

  const toggleOption = (optionId: string): void => {
    if (responding) return;
    if (question.multiSelect) {
      const selected = draft.selected.includes(optionId)
        ? draft.selected.filter((id) => id !== optionId)
        : [...draft.selected, optionId];
      setDraft({ ...draft, selected });
      return;
    }
    const next = { ...withCustomText(), selected: [optionId] };
    setDraft(next);
    advanceOrSubmit(next);
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
            {questions.length > 1 ? (
              <Text modifiers={[font({ textStyle: 'caption' }), SECONDARY]}>
                {t('questionProgress', { current: index + 1, total: questions.length })}
              </Text>
            ) : null}
            <Image
              systemName="xmark"
              size={13}
              modifiers={[
                TERTIARY,
                WHOLE_ROW,
                onTapGesture(() => {
                  if (!responding) onRespond({ outcome: 'cancelled' });
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
          <TextField text={customText} placeholder={t('customAnswerPlaceholder')} />
          <Button
            label={isLast ? t('submitAnswers') : t('next')}
            onPress={() => advanceOrSubmit(withCustomText())}
            modifiers={[buttonStyle('borderedProminent'), disabled(responding)]}
          />
        </VStack>
      </Host>
    </View>
  );
}
