import type { ToolCall } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { Collapsible, CollapsibleTrigger } from 'coss-ui/components/collapsible';
import { Spinner } from 'coss-ui/components/spinner';
import { BotIcon, Maximize2Icon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { ContentBlockView } from './content-block-view';
import { contentDerivedEntries } from './content-derived-keys';
import type { QuestionConversationItem } from './conversation-prompts';
import { ChatDisclosureContent } from './disclosure-content';
import {
  CHAT_DISCLOSURE_SUMMARY_CLASS_NAME,
  CHAT_DISCLOSURE_TEXT_CLASS_NAME,
  CHAT_DISCLOSURE_TITLE_CLASS_NAME,
  CHAT_DISCLOSURE_TRIGGER_CLASS_NAME,
  ChatDisclosureChevron,
  ChatDisclosureIconSlot,
} from './disclosure-header';
import { Message, MessageContent } from './message';
import { QuestionCallItem } from './question-call-item';
import { subagentTaskInput } from './subagent-task-input';
import { ThoughtBlock } from './thought-block';
import { ToolCallBody, ToolCallItem } from './tool-call-item';
import { toolCallDisplayText } from './tool-result-content';
import { toolCallFailureMessage } from './tool-utils';
import type { ConversationItem } from './types';

interface SubagentTranscriptProps {
  /** The spawning `task`-kind tool call. */
  toolCall: ToolCall;
  /** The subagent's items (narration / reasoning / tool calls), in arrival order. */
  items: readonly ConversationItem[];
  /** The whole slice's parent→children buckets, so nested spawns can recurse into their own card. */
  childrenByParent: ReadonlyMap<string, ConversationItem[]>;
  awaitingApproval: ReadonlySet<string>;
  awaitingAnswer: ReadonlySet<string>;
  questionsByToolCall: ReadonlyMap<string, QuestionConversationItem>;
  declined: ReadonlySet<string>;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  onExpand?: (toolCallId: string) => void;
}

/** Nested transcript body, shared by the inline card and the full-size viewer. A nested spawn
 * must recurse into its own SubagentCard — partitioning buckets grandchildren under the inner
 * task, so a plain tool row would silently drop them. The Task's own rawOutput renders only as
 * the empty-transcript fallback (the transcript already ends with the subagent's report). */
export function SubagentTranscript({
  toolCall,
  items,
  childrenByParent,
  awaitingApproval,
  awaitingAnswer,
  questionsByToolCall,
  declined,
  TerminalBlockComponent,
  onExpand,
}: SubagentTranscriptProps): React.ReactNode {
  const taskResult =
    toolCallDisplayText(toolCall).trim() || toolCallFailureMessage(toolCall)?.trim();
  if (items.length === 0) {
    return (
      <div className="space-y-2">
        <ToolCallBody TerminalBlockComponent={TerminalBlockComponent} toolCall={toolCall} />
      </div>
    );
  }
  return (
    <>
      {items.map((item) => {
        switch (item.kind) {
          case 'message':
            return (
              <Message key={item.id} from="assistant">
                <MessageContent className="space-y-1">
                  {contentDerivedEntries(item.blocks).map(({ item: block, key }) => (
                    <ContentBlockView key={key} block={block} />
                  ))}
                </MessageContent>
              </Message>
            );
          case 'reasoning':
            return (
              <ThoughtBlock
                key={item.id}
                blocks={item.blocks}
                endedAt={item.endedAt}
                isStreaming={item.isStreaming}
                startedAt={item.startedAt}
                summary={item.summary}
                constrainHeight={false}
              />
            );
          case 'tool': {
            if (item.toolCall.kind === 'task') {
              return (
                <SubagentCardContent
                  key={item.id}
                  awaitingApproval={awaitingApproval}
                  awaitingAnswer={awaitingAnswer}
                  questionsByToolCall={questionsByToolCall}
                  childrenByParent={childrenByParent}
                  constrainHeight={false}
                  declined={declined}
                  items={childrenByParent.get(item.toolCall.toolCallId) ?? []}
                  onExpand={onExpand}
                  TerminalBlockComponent={TerminalBlockComponent}
                  toolCall={item.toolCall}
                />
              );
            }
            const question = questionsByToolCall.get(item.toolCall.toolCallId);
            if (question) {
              return (
                <QuestionCallItem
                  key={item.id}
                  awaitingAnswer={awaitingAnswer.has(item.toolCall.toolCallId)}
                  constrainHeight={false}
                  question={question}
                  toolCall={item.toolCall}
                />
              );
            }
            return (
              <ToolCallItem
                key={item.id}
                awaitingApproval={awaitingApproval.has(item.toolCall.toolCallId)}
                awaitingAnswer={awaitingAnswer.has(item.toolCall.toolCallId)}
                constrainHeight={false}
                declined={declined.has(item.toolCall.toolCallId)}
                toolCall={item.toolCall}
                TerminalBlockComponent={TerminalBlockComponent}
              />
            );
          }
          default:
            return null;
        }
      })}
      {taskResult && !transcriptIncludes(items, taskResult) ? (
        <div className="space-y-2">
          <ToolCallBody TerminalBlockComponent={TerminalBlockComponent} toolCall={toolCall} />
        </div>
      ) : null}
    </>
  );
}

function transcriptIncludes(items: readonly ConversationItem[], text: string): boolean {
  return items.some(
    (item) =>
      item.kind === 'message' &&
      item.role === 'assistant' &&
      item.blocks.some((block) => block.type === 'text' && block.text.includes(text)),
  );
}

export type SubagentCardProps = SubagentTranscriptProps;

export function SubagentCard(props: SubagentCardProps): React.ReactNode {
  return <SubagentCardContent {...props} constrainHeight />;
}

/** Inline collapsible card for one subagent run. Auto-open while running, but the user's toggle
 * always wins — a subagent can run for minutes. */
function SubagentCardContent({
  toolCall,
  items,
  childrenByParent,
  awaitingApproval,
  awaitingAnswer,
  questionsByToolCall,
  declined,
  TerminalBlockComponent,
  onExpand,
  constrainHeight,
}: SubagentCardProps & { constrainHeight: boolean }): React.ReactNode {
  const t = useTranslations('workbench.subagent');

  const isRunning = toolCall.status === 'in_progress' || toolCall.status === 'pending';
  const hasFailedActivity =
    toolCall.status === 'failed' ||
    items.some((item) => item.kind === 'tool' && item.toolCall.status === 'failed');
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? isRunning;

  const input = subagentTaskInput(toolCall.rawInput);

  return (
    <Collapsible className="w-full" onOpenChange={setManualOpen} open={open}>
      <div className="flex w-full items-center gap-2">
        <CollapsibleTrigger className={cn(CHAT_DISCLOSURE_TRIGGER_CLASS_NAME, 'min-w-0 flex-1')}>
          <ChatDisclosureIconSlot>
            {isRunning ? (
              <Spinner className="text-foreground" />
            ) : (
              <BotIcon
                className={cn(
                  hasFailedActivity ? 'text-destructive-foreground' : 'text-muted-foreground',
                )}
              />
            )}
          </ChatDisclosureIconSlot>
          <span className={CHAT_DISCLOSURE_TEXT_CLASS_NAME}>
            <span className={CHAT_DISCLOSURE_TITLE_CLASS_NAME}>
              {input.subagentType ?? t('label')}
            </span>
            <span className={CHAT_DISCLOSURE_SUMMARY_CLASS_NAME}>
              {input.description ?? toolCall.title}
            </span>
          </span>
          {hasFailedActivity ? (
            <span className="shrink-0 text-destructive-foreground text-xs">{t('failedBadge')}</span>
          ) : null}
          <ChatDisclosureChevron />
        </CollapsibleTrigger>
        {onExpand ? (
          <Button
            aria-label={t('viewTranscript')}
            className="shrink-0"
            onClick={() => onExpand(toolCall.toolCallId)}
            size="icon-xs"
            title={t('viewTranscript')}
            type="button"
            variant="ghost"
          >
            <Maximize2Icon className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <ChatDisclosureContent
        bodyClassName="space-y-2"
        className="mt-1 border-l-2 border-border pl-3"
        // Nested task cards share the root card's scroll container to avoid scroll traps.
        constrainHeight={constrainHeight}
      >
        <SubagentTranscript
          awaitingApproval={awaitingApproval}
          awaitingAnswer={awaitingAnswer}
          questionsByToolCall={questionsByToolCall}
          childrenByParent={childrenByParent}
          declined={declined}
          items={items}
          onExpand={onExpand}
          TerminalBlockComponent={TerminalBlockComponent}
          toolCall={toolCall}
        />
      </ChatDisclosureContent>
    </Collapsible>
  );
}
