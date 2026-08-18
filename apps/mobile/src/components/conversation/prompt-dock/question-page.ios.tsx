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
import { useNativePalette } from '@mobile/components/theme/native-palette';
import { View } from 'react-native';
import { useTranslations } from 'use-intl';
import type { QuestionPageProps } from './question-page.types';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const TERTIARY = foregroundStyle({ type: 'hierarchical', style: 'tertiary' });
const WHOLE_ROW = contentShape(shapes.rectangle());

/** One question page on SwiftUI: option rows draw their own checkmark, single-select
 * auto-advances through `onAdvance`. */
export function QuestionPage({
  question,
  draft,
  current,
  total,
  isLast,
  responding,
  onDraftChange,
  onAdvance,
  onCancel,
}: QuestionPageProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const palette = useNativePalette();
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
    <View
      className="rounded-xl border px-3 py-2.5"
      style={{ backgroundColor: palette.background, borderColor: palette.outline }}
    >
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
