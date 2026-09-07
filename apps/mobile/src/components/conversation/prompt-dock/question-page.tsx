import {
  Button,
  Checkbox,
  Column,
  OutlinedTextField,
  RadioButton,
  Row,
  Text,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import { clickable, fillMaxWidth, weight } from '@expo/ui/jetpack-compose/modifiers';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { NativeIconButton } from '@mobile/components/form/icon-button';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import { Text as RNText, View } from 'react-native';
import { useTranslations } from 'use-intl';
import type { QuestionPageProps } from './question-page.types';

/** One question page on Android: MD3 radio rows (checkboxes under `multiSelect`), an outlined
 * free-text field, and a filled advance button. Header stays RN so the lucide close glyph and
 * theme tokens match the card chrome. */
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
  const colors = useAppMaterialColors();
  // Each page owns a distinct native state; the orchestrator remounts pages by key so a stale
  // native write from the previous question cannot leak here.
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
      className="gap-2.5 rounded-xl border px-3 py-2.5"
      style={{ backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant }}
    >
      <View className="flex-row items-center gap-2">
        {question.header ? (
          <RNText className="font-semibold text-caption" style={{ color: colors.onSurfaceVariant }}>
            {question.header}
          </RNText>
        ) : null}
        <RNText className="flex-1 font-semibold text-subhead" style={{ color: colors.onSurface }}>
          {question.prompt}
        </RNText>
        {total > 1 ? (
          <RNText className="text-caption" style={{ color: colors.onSurfaceVariant }}>
            {t('questionProgress', { current, total })}
          </RNText>
        ) : null}
        <NativeIconButton
          icon="close"
          label={t('cancel')}
          disabled={responding}
          onPress={onCancel}
        />
      </View>
      <ThemedHost matchContents={{ vertical: true }}>
        <Column verticalArrangement={{ spacedBy: 10 }} modifiers={[fillMaxWidth()]}>
          <Column verticalArrangement={{ spacedBy: 2 }}>
            {question.options.map((option) => {
              const selected = draft.selected.includes(option.optionId);
              return (
                <Row
                  key={option.optionId}
                  verticalAlignment="center"
                  horizontalArrangement={{ spacedBy: 8 }}
                  modifiers={[clickable(() => toggleOption(option.optionId)), fillMaxWidth()]}
                >
                  {question.multiSelect ? (
                    <Checkbox value={selected} />
                  ) : (
                    <RadioButton selected={selected} />
                  )}
                  <Column verticalArrangement={{ spacedBy: 1 }} modifiers={[weight(1)]}>
                    <Text style={{ typography: 'bodyMedium' }}>{option.label}</Text>
                    {option.description ? (
                      <Text style={{ typography: 'bodySmall' }} color={colors.onSurfaceVariant}>
                        {option.description}
                      </Text>
                    ) : null}
                  </Column>
                </Row>
              );
            })}
          </Column>
          <OutlinedTextField
            value={customText}
            singleLine
            onValueChange={(text) => {
              if (text.trim() && draft.selected.length > 0) {
                onDraftChange({ selected: [], customText: text });
              }
            }}
            modifiers={[fillMaxWidth()]}
          >
            <OutlinedTextField.Placeholder>
              <Text color={colors.onSurfaceVariant}>{t('customAnswerPlaceholder')}</Text>
            </OutlinedTextField.Placeholder>
          </OutlinedTextField>
          <Button enabled={!responding} onClick={advance} modifiers={[fillMaxWidth()]}>
            <Text>{isLast ? t('submitAnswers') : t('next')}</Text>
          </Button>
        </Column>
      </ThemedHost>
    </View>
  );
}
