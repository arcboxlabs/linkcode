import type {
  PermissionOption,
  PermissionOutcome,
  Plan,
  Question,
  QuestionOutcome,
  ToolCallUpdate,
} from '@linkcode/schema';
import { useThemeColor } from 'heroui-native';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { PermissionPrompt } from './permission-prompt';
import { PlanTracker } from './plan-tracker';
import { QuestionPrompt } from './question-prompt';

export interface PendingApproval {
  requestId: string;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
}

export interface PendingQuestion {
  requestId: string;
  questions: Question[];
}

/**
 * Desktop `ConversationPromptDock` priority model: one prompt at a time; a question is a
 * hard boundary (nothing pages past it); multiple pending permissions page with ‹ N/M ›.
 * The current turn's plan renders as a collapsed step tracker below whichever prompt shows.
 */
export function PromptDock({
  approvals,
  questions,
  plan,
  respondingIds,
  onRespondPermission,
  onRespondQuestion,
}: {
  approvals: PendingApproval[];
  questions: PendingQuestion[];
  plan: Plan | null;
  respondingIds: ReadonlySet<string>;
  onRespondPermission: (requestId: string, outcome: PermissionOutcome) => void;
  onRespondQuestion: (requestId: string, outcome: QuestionOutcome) => void;
}): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const [page, setPage] = useState(0);
  const muted = useThemeColor('muted');

  const question = questions[0];
  const pageCount = approvals.length;
  const pageIndex = Math.min(page, Math.max(0, pageCount - 1));
  const approval = question ? undefined : approvals[pageIndex];

  if (!question && !approval && !plan) return null;

  return (
    <View className="gap-2 px-4 pb-2">
      {question ? (
        <QuestionPrompt
          key={question.requestId}
          questions={question.questions}
          responding={respondingIds.has(question.requestId)}
          onRespond={(outcome) => onRespondQuestion(question.requestId, outcome)}
        />
      ) : approval ? (
        <View className="gap-1">
          {pageCount > 1 ? (
            <View className="flex-row items-center justify-end gap-1">
              <Pressable
                accessibilityRole="button"
                disabled={pageIndex === 0}
                onPress={() => setPage(pageIndex - 1)}
                className="size-8 items-center justify-center"
              >
                <ChevronLeftIcon size={14} color={muted} />
              </Pressable>
              <Text className="text-footnote text-muted">
                {t('questionProgress', { current: pageIndex + 1, total: pageCount })}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={pageIndex >= pageCount - 1}
                onPress={() => setPage(pageIndex + 1)}
                className="size-8 items-center justify-center"
              >
                <ChevronRightIcon size={14} color={muted} />
              </Pressable>
            </View>
          ) : null}
          <PermissionPrompt
            key={approval.requestId}
            toolCall={approval.toolCall}
            options={approval.options}
            responding={respondingIds.has(approval.requestId)}
            onRespond={(outcome) => onRespondPermission(approval.requestId, outcome)}
          />
        </View>
      ) : null}
      {plan ? <PlanTracker plan={plan} /> : null}
    </View>
  );
}
