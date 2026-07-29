import type { PermissionOutcome, QuestionOutcome } from '@linkcode/schema';
import type { CurrentPlan, PromptConversationItem } from '@linkcode/ui/native';
import { useThemeColor } from 'heroui-native';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useTranslations } from 'use-intl';
import { PermissionPrompt } from './permission-prompt';
import { PlanTracker } from './plan-tracker';
import { QuestionPrompt } from './question-prompt';

type ApprovalPrompt = Extract<PromptConversationItem, { kind: 'approval' }>;

/**
 * Desktop `ConversationPromptDock` priority model: pending asks retain arrival order; a question
 * is a hard boundary, while consecutive permissions before it page with ‹ N/M ›.
 * The current turn's plan renders as a collapsed step tracker below whichever prompt shows.
 */
export function PromptDock({
  prompts,
  plan,
  respondingIds,
  onRespondPermission,
  onRespondQuestion,
}: {
  prompts: PromptConversationItem[];
  plan: CurrentPlan | null;
  respondingIds: ReadonlySet<string>;
  onRespondPermission: (requestId: string, outcome: PermissionOutcome) => void;
  onRespondQuestion: (requestId: string, outcome: QuestionOutcome) => void;
}): React.ReactNode {
  const question = prompts[0]?.kind === 'question' ? prompts[0] : undefined;
  const firstQuestionIndex = prompts.findIndex((prompt) => prompt.kind === 'question');
  const approvals = prompts
    .slice(0, firstQuestionIndex >= 0 ? firstQuestionIndex : undefined)
    .filter((prompt): prompt is ApprovalPrompt => prompt.kind === 'approval');

  if (!question && !plan && approvals.length === 0) return null;

  return (
    <View className="gap-2 px-4 pb-2">
      {question ? (
        <QuestionPrompt
          key={question.requestId}
          questions={question.questions}
          responding={question.responding || respondingIds.has(question.requestId)}
          onRespond={(outcome) => onRespondQuestion(question.requestId, outcome)}
        />
      ) : approvals.length > 0 ? (
        <PermissionPager
          key={approvals[0].requestId}
          approvals={approvals}
          respondingIds={respondingIds}
          onRespond={onRespondPermission}
        />
      ) : null}
      {plan ? <PlanTracker plan={plan} /> : null}
    </View>
  );
}

function PermissionPager({
  approvals,
  respondingIds,
  onRespond,
}: {
  approvals: ApprovalPrompt[];
  respondingIds: ReadonlySet<string>;
  onRespond: (requestId: string, outcome: PermissionOutcome) => void;
}): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const [page, setPage] = useState(0);
  const muted = useThemeColor('muted');
  const pageIndex = Math.min(page, approvals.length - 1);
  const approval = approvals[pageIndex];

  return (
    <View className="gap-1">
      {approvals.length > 1 ? (
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
            {t('questionProgress', { current: pageIndex + 1, total: approvals.length })}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={pageIndex >= approvals.length - 1}
            onPress={() => setPage(pageIndex + 1)}
            className="size-8 items-center justify-center"
          >
            <ChevronRightIcon size={14} color={muted} />
          </Pressable>
        </View>
      ) : null}
      <PermissionPrompt
        toolCall={approval.toolCall}
        options={approval.options}
        responding={approval.responding || respondingIds.has(approval.requestId)}
        onRespond={(outcome) => onRespond(approval.requestId, outcome)}
      />
    </View>
  );
}
