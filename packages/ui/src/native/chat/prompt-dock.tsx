import type {
  PermissionOption,
  PermissionOutcome,
  Plan,
  Question,
  QuestionOutcome,
  ToolCallUpdate,
} from '@linkcode/schema';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
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

export interface PromptDockProps {
  approvals: PendingApproval[];
  questions: PendingQuestion[];
  /** Current turn's plan, rendered as the collapsed step tracker below any prompt. */
  plan: Plan | null;
  /** requestId currently being answered (in flight). */
  respondingRequestId?: string;
  respondingOptionId?: string;
  onRespondPermission: (requestId: string, outcome: PermissionOutcome) => void;
  onRespondQuestion: (requestId: string, outcome: QuestionOutcome) => void;
}

/**
 * Desktop `ConversationPromptDock` priority model: one prompt at a time; a question is a
 * hard boundary (nothing pages past it); multiple pending permissions page with ‹ N/M ›.
 */
export function PromptDock({
  approvals,
  questions,
  plan,
  respondingRequestId,
  respondingOptionId,
  onRespondPermission,
  onRespondQuestion,
}: PromptDockProps): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const [page, setPage] = useState(0);
  const mutedColor = String(useCSSVariable('--muted'));

  const question = questions[0];
  const pageCount = approvals.length;
  const pageIndex = Math.min(page, Math.max(0, pageCount - 1));
  const approval = question ? undefined : approvals[pageIndex];

  return (
    <View className="gap-2 px-4 pb-2">
      {question ? (
        <QuestionPrompt
          key={question.requestId}
          questions={question.questions}
          responding={respondingRequestId === question.requestId}
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
                <ChevronLeft size={14} color={mutedColor} />
              </Pressable>
              <Text className="text-[11px] text-muted">
                {t('questionProgress', { current: pageIndex + 1, total: pageCount })}
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={pageIndex >= pageCount - 1}
                onPress={() => setPage(pageIndex + 1)}
                className="size-8 items-center justify-center"
              >
                <ChevronRight size={14} color={mutedColor} />
              </Pressable>
            </View>
          ) : null}
          <PermissionPrompt
            key={approval.requestId}
            toolCall={approval.toolCall}
            options={approval.options}
            respondingOptionId={
              respondingRequestId === approval.requestId ? respondingOptionId : undefined
            }
            onRespond={(outcome) => onRespondPermission(approval.requestId, outcome)}
          />
        </View>
      ) : null}
      {plan ? <PlanTracker plan={plan} /> : null}
    </View>
  );
}
