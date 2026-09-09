import {
  Button,
  Checkbox,
  Column,
  OutlinedTextField,
  RadioButton,
  Row,
  Text,
  TextButton,
  useNativeState,
} from '@expo/ui/jetpack-compose';
import {
  defaultMinSize,
  fillMaxWidth,
  selectable,
  selectableGroup,
  toggleable,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { useTranslations } from 'use-intl';
import type { QuestionPageProps } from './question-page.types';

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
  onClose,
}: QuestionPageProps & { onClose: () => void }): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const tQuestion = useTranslations('workbench.question');
  const colors = useAppMaterialColors();
  // Each page owns a distinct native state; the orchestrator remounts pages by key so a stale
  // native write from the previous question cannot leak here.
  const customText = useNativeState(draft.customText);

  const advance = (): void => {
    const text = customText.get().trim();
    onAdvance(text ? { selected: [], customText: text } : { ...draft, customText: '' });
  };

  return (
    <Column verticalArrangement={{ spacedBy: 12 }} modifiers={[fillMaxWidth()]}>
      <Row verticalAlignment="center" modifiers={[fillMaxWidth()]}>
        {current > 1 ? (
          <TextButton
            enabled={!responding}
            onClick={() => onPrevious({ ...draft, customText: customText.get() })}
          >
            <Text>{tQuestion('previous')}</Text>
          </TextButton>
        ) : null}
        <Text
          style={{ typography: 'labelMedium' }}
          color={colors.onSurfaceVariant}
          modifiers={[weight(1)]}
        >
          {t('questionProgress', { current, total })}
        </Text>
        <TextButton
          onClick={() => {
            onDraftChange({ ...draft, customText: customText.get() });
            onClose();
          }}
        >
          <Text>{t('close')}</Text>
        </TextButton>
      </Row>
      <Text style={{ typography: 'titleLarge' }} color={colors.onSurface}>
        {question.prompt}
      </Text>
      <Text style={{ typography: 'bodySmall' }} color={colors.onSurfaceVariant}>
        {question.multiSelect ? tQuestion('instructionMultiple') : tQuestion('instructionSingle')}
      </Text>
      <Column verticalArrangement={{ spacedBy: 10 }} modifiers={[fillMaxWidth()]}>
        <Column
          verticalArrangement={{ spacedBy: 2 }}
          modifiers={question.multiSelect ? [] : [selectableGroup()]}
        >
          {question.options.map((option) => {
            const selected = draft.selected.includes(option.optionId);
            return (
              <Row
                key={option.optionId}
                verticalAlignment="center"
                horizontalArrangement={{ spacedBy: 8 }}
                modifiers={[
                  fillMaxWidth(),
                  defaultMinSize({ minHeight: 48 }),
                  ...(responding
                    ? []
                    : [
                        question.multiSelect
                          ? toggleable(
                              selected,
                              () => {
                                customText.set('');
                                onSelectOption(option.optionId);
                              },
                              {
                                role: 'checkbox',
                              },
                            )
                          : selectable(
                              selected,
                              () => {
                                customText.set('');
                                onSelectOption(option.optionId);
                              },
                              'radioButton',
                            ),
                      ]),
                ]}
              >
                {question.multiSelect ? (
                  <Checkbox value={selected} enabled={!responding} />
                ) : (
                  <RadioButton selected={selected} />
                )}
                <Column verticalArrangement={{ spacedBy: 1 }} modifiers={[weight(1)]}>
                  <Text style={{ typography: 'bodyLarge' }} color={colors.onSurface}>
                    {option.label}
                  </Text>
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
          enabled={!responding}
          singleLine
          onValueChange={(text) => {
            onDraftChange({ selected: text.trim() ? [] : draft.selected, customText: text });
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
        <TextButton enabled={!responding} onClick={onCancel} modifiers={[fillMaxWidth()]}>
          <Text>{tQuestion('dismiss')}</Text>
        </TextButton>
      </Column>
    </Column>
  );
}
