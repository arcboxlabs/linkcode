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
  accessibilityLabel,
  buttonStyle,
  contentShape,
  disabled,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  labelStyle,
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
  onPrevious,
  onSelectOption,
  onCancel,
}: QuestionPageProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const tQuestion = useTranslations('workbench.question');
  const palette = useNativePalette();
  // Each page owns a distinct native state. Remounting after a structured selection guarantees
  // that an asynchronous native write from the previous question/answer mode cannot leak here.
  const customText = useNativeState(draft.customText);

  const advance = (): void => {
    const text = customText.get().trim();
    onAdvance(text ? { selected: [], customText: text } : { ...draft, customText: '' });
  };

  return (
    <View
      className="rounded-xl border px-3 py-2.5"
      style={{ backgroundColor: palette.background, borderColor: palette.outline }}
    >
      <Host matchContents={{ vertical: true }}>
        <VStack alignment="leading" spacing={10}>
          <HStack spacing={8}>
            {current > 1 ? (
              <Button
                label={tQuestion('previous')}
                systemImage="chevron.left"
                onPress={() => onPrevious({ ...draft, customText: customText.get() })}
                modifiers={[
                  labelStyle('iconOnly'),
                  buttonStyle('borderless'),
                  disabled(responding),
                  frame({ minWidth: 44, minHeight: 44 }),
                ]}
              />
            ) : null}
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
            <Button
              label={t('cancel')}
              systemImage="xmark"
              onPress={onCancel}
              modifiers={[
                labelStyle('iconOnly'),
                buttonStyle('borderless'),
                disabled(responding),
                frame({ minWidth: 44, minHeight: 44 }),
              ]}
            />
          </HStack>
          <VStack alignment="leading" spacing={2}>
            {question.options.map((option) => {
              const selected = draft.selected.includes(option.optionId);
              return (
                <Button
                  key={option.optionId}
                  onPress={() => onSelectOption(option.optionId)}
                  modifiers={[
                    buttonStyle('plain'),
                    disabled(responding),
                    accessibilityLabel(option.label),
                  ]}
                >
                  <HStack spacing={8} modifiers={[WHOLE_ROW, frame({ minHeight: 44 })]}>
                    <Image
                      systemName={selected ? 'checkmark.circle.fill' : 'circle'}
                      size={16}
                      modifiers={selected ? [] : [TERTIARY]}
                    />
                    <VStack alignment="leading" spacing={1}>
                      <Text modifiers={[font({ textStyle: 'subheadline' })]}>{option.label}</Text>
                      {option.description ? (
                        <Text
                          modifiers={[
                            font({ textStyle: 'footnote' }),
                            SECONDARY,
                            fixedSize({ horizontal: false, vertical: true }),
                          ]}
                        >
                          {option.description}
                        </Text>
                      ) : null}
                    </VStack>
                    <Spacer />
                  </HStack>
                </Button>
              );
            })}
          </VStack>
          <TextField
            text={customText}
            modifiers={[disabled(responding)]}
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
