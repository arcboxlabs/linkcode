import { Column, FilledTonalButton, ModalBottomSheet, Row, Text } from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  paddingAll,
  verticalScroll,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';
import type { Question, QuestionOutcome } from '@linkcode/schema';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import { useState } from 'react';
import { Alert } from 'react-native';
import { useTranslations } from 'use-intl';
import { QuestionPage } from './question-page';
import { useQuestionResponse } from './use-question-response';

export function QuestionPrompt({
  questions,
  responding,
  onRespond,
}: {
  questions: Question[];
  responding: boolean;
  onRespond: (outcome: QuestionOutcome) => void;
}): React.ReactNode {
  const [open, setOpen] = useState(false);
  const colors = useAppMaterialColors();
  const t = useTranslations('mobile.chat');
  const tq = useTranslations('workbench.question');
  const { question, draft, current, total, isLast, setDraft, advance, previous, selectOption } =
    useQuestionResponse(questions, responding, onRespond);
  return (
    <>
      <ThemedHost matchContents={{ vertical: true }}>
        <Row
          verticalAlignment="center"
          horizontalArrangement={{ spacedBy: 12 }}
          modifiers={[fillMaxWidth()]}
        >
          <Column modifiers={[weight(1)]}>
            <Text style={{ typography: 'labelMedium' }} color={colors.onSurfaceVariant}>
              {tq('callTitle')}
            </Text>
            <Text
              style={{ typography: 'bodyMedium' }}
              color={colors.onSurface}
              maxLines={2}
              overflow="ellipsis"
            >
              {question.prompt}
            </Text>
          </Column>
          <FilledTonalButton onClick={() => setOpen(true)}>
            <Text>{t('answer')}</Text>
          </FilledTonalButton>
        </Row>
      </ThemedHost>
      {open ? (
        <ThemedHost style={{ position: 'absolute' }} pointerEvents="box-none">
          <ModalBottomSheet
            onDismissRequest={() => setOpen(false)}
            skipPartiallyExpanded
            contentColor={colors.onSurface}
          >
            <Column modifiers={[verticalScroll(), paddingAll(20)]}>
              <QuestionPage
                key={question.questionId}
                question={question}
                draft={draft}
                current={current}
                total={total}
                isLast={isLast}
                responding={responding}
                onDraftChange={setDraft}
                onAdvance={advance}
                onPrevious={previous}
                onSelectOption={selectOption}
                onClose={() => setOpen(false)}
                onCancel={() =>
                  Alert.alert(tq('dismissConfirmTitle'), tq('dismissConfirmDescription'), [
                    { text: tq('dismissConfirmCancel'), style: 'cancel' },
                    {
                      text: tq('dismissConfirmAction'),
                      style: 'destructive',
                      onPress: () => onRespond({ outcome: 'cancelled' }),
                    },
                  ])
                }
              />
            </Column>
          </ModalBottomSheet>
        </ThemedHost>
      ) : null}
    </>
  );
}
