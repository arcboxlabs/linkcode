import type { Question, QuestionAnswer, ToolCall } from '@linkcode/schema';
import { MessageCircleQuestionMarkIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import type { QuestionConversationItem } from './conversation-prompts';
import { Tool, ToolContent, ToolHeader } from './tool';

/** Timeline record of an agent question ask. The dock's QuestionPrompt is the actionable
 * surface; this row presents the asked questions and the user's answers instead of the tool
 * call's raw payload. */
export function QuestionCallItem({
  toolCall,
  question,
  awaitingAnswer = false,
  constrainHeight = true,
}: {
  toolCall: ToolCall;
  question: QuestionConversationItem;
  /** The ask is still awaiting the user's answer. */
  awaitingAnswer?: boolean;
  /** Disable when a parent transcript owns the capped scroll container. */
  constrainHeight?: boolean;
}): React.ReactNode {
  const t = useTranslations('workbench.question');
  const tt = useTranslations('workbench.tool');

  const outcome = question.resolution?.outcome;
  const answerByQuestion = new Map(
    (outcome?.outcome === 'answered' ? outcome.answers : []).map((answer) => [
      answer.questionId,
      answer,
    ]),
  );
  const single = question.questions.length === 1 ? question.questions[0] : undefined;

  return (
    <Tool>
      <ToolHeader
        awaitingAnswer={awaitingAnswer}
        hasBody
        icon={<MessageCircleQuestionMarkIcon className="size-3.5 shrink-0 text-muted-foreground" />}
        kind={toolCall.kind}
        status={toolCall.status}
        statusLabel={
          outcome?.outcome === 'cancelled'
            ? t('dismissed')
            : toolCall.status === 'failed'
              ? tt('failed')
              : undefined
        }
        summary={single?.prompt}
        title={t('callTitle')}
      />
      <ToolContent constrainHeight={constrainHeight}>
        <div className="space-y-2 text-sm">
          {question.questions.map((entry) => {
            const answer = answerByQuestion.get(entry.questionId);
            return (
              <div key={entry.questionId}>
                <p className="text-muted-foreground">{entry.prompt}</p>
                {answer ? <p>{answerText(entry, answer) ?? t('skipped')}</p> : null}
              </div>
            );
          })}
        </div>
      </ToolContent>
    </Tool>
  );
}

/** Chosen option labels plus any custom text; undefined when the question was skipped. */
function answerText(question: Question, answer: QuestionAnswer): string | undefined {
  const labelByOption = new Map(question.options.map((option) => [option.optionId, option.label]));
  const parts = answer.selectedOptionIds.map((optionId) => labelByOption.get(optionId) ?? optionId);
  if (answer.customText) parts.push(answer.customText);
  return parts.length > 0 ? parts.join(', ') : undefined;
}
