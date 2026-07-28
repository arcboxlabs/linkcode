import type { QuestionOutcome } from '@linkcode/schema';
import { useTranslations } from 'use-intl';
import { CircularProgress } from '../chat/circular-progress';
import type { CurrentPlan, PermissionDecision } from '../chat/conversation-prompts';
import { selectCurrentPlan, selectPendingPromptItems } from '../chat/conversation-prompts';
import {
  CHAT_DISCLOSURE_SUMMARY_CLASS_NAME,
  CHAT_DISCLOSURE_TEXT_CLASS_NAME,
  CHAT_DISCLOSURE_TITLE_CLASS_NAME,
  ChatDisclosureChevron,
  ChatDisclosureIconSlot,
} from '../chat/disclosure-header';
import { Step, StepContent, StepHeader, StepItem } from '../chat/step';
import type { ConversationViewModel } from '../chat/types';
import { cn } from '../lib/cn';
import { PermissionPrompt } from './permission-prompt';
import { QuestionPrompt } from './question-prompt';

const EMPTY_RESPONSE_ERRORS = new Map<string, string>();

/** Actionable prompts pinned above the composer: the current plan and pending permission/question asks. */
export function ConversationPromptDock({
  conversation,
  respondingRequestIds,
  responseErrors = EMPTY_RESPONSE_ERRORS,
  onRespondPermission,
  onRespondQuestion,
}: {
  conversation: ConversationViewModel;
  respondingRequestIds: ReadonlySet<string>;
  responseErrors?: ReadonlyMap<string, string>;
  onRespondPermission: (requestId: string, decision: PermissionDecision) => void;
  onRespondQuestion: (requestId: string, outcome: QuestionOutcome) => void;
}): React.ReactNode {
  const plan = selectCurrentPlan(conversation);
  const pendingPrompts = selectPendingPromptItems(conversation);
  const currentPrompt = pendingPrompts.at(0);

  if (!plan && !currentPrompt) return null;
  const queuedCount = Math.max(0, pendingPrompts.length - 1);

  return (
    <div className="shrink-0 px-4 py-2">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {plan ? <StepPromptRow plan={plan} /> : null}
        {currentPrompt?.kind === 'approval' ? (
          <PermissionPrompt
            key={currentPrompt.requestId}
            error={responseErrors.get(currentPrompt.requestId)}
            item={currentPrompt}
            queuedCount={queuedCount}
            responding={
              currentPrompt.responding || respondingRequestIds.has(currentPrompt.requestId)
            }
            onRespond={onRespondPermission}
          />
        ) : currentPrompt ? (
          <QuestionPrompt
            key={currentPrompt.requestId}
            autoFocusFirstChoice
            error={responseErrors.get(currentPrompt.requestId)}
            item={currentPrompt}
            queuedCount={queuedCount}
            responding={
              currentPrompt.responding || respondingRequestIds.has(currentPrompt.requestId)
            }
            onRespond={onRespondQuestion}
          />
        ) : null}
      </div>
    </div>
  );
}

function StepPromptRow({ plan }: { plan: CurrentPlan }): React.ReactNode {
  const t = useTranslations('workbench.step');
  const entry = plan.item.plan.entries[plan.currentIndex];

  return (
    <Step className="my-0 px-3 py-1.5" defaultOpen={false}>
      <StepHeader title={t('title')}>
        <ChatDisclosureIconSlot className="text-muted-foreground">
          <CircularProgress className="size-3.5" value={plan.currentIndex + 1} max={plan.total} />
        </ChatDisclosureIconSlot>
        <span className={CHAT_DISCLOSURE_TEXT_CLASS_NAME}>
          <span className={CHAT_DISCLOSURE_TITLE_CLASS_NAME}>
            {t('title')} {t('progress', { current: plan.currentIndex + 1, total: plan.total })}
          </span>
          <span
            className={cn(
              CHAT_DISCLOSURE_SUMMARY_CLASS_NAME,
              'font-normal text-muted-foreground',
              plan.complete && 'line-through',
            )}
          >
            {entry.content}
          </span>
        </span>
        <ChatDisclosureChevron />
      </StepHeader>
      <StepContent>
        {plan.item.plan.entries.map((item, index) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- plan is a full snapshot replaced per event; index+status is a stable position key
          <StepItem key={`${index}:${item.status}`} status={item.status}>
            {item.content}
          </StepItem>
        ))}
      </StepContent>
    </Step>
  );
}
