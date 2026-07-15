import type { ToolCall } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { Spinner } from 'coss-ui/components/spinner';
import { BotIcon, ChevronRightIcon, Maximize2Icon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { ContentBlockView } from './content-block-view';
import { contentDerivedEntries } from './content-derived-keys';
import { Message, MessageContent } from './message';
import { subagentTaskInput } from './subagent-task-input';
import { ThoughtBlock } from './thought-block';
import { TOOL_DETAIL_SCROLL_CLASS_NAME } from './tool';
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
  declined: ReadonlySet<string>;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  onExpand?: (toolCallId: string) => void;
}

/** The nested transcript body, shared between the inline card and the full-size viewer. Children
 * render linearly (no recursive activity grouping), except a nested spawn (`task`-kind child),
 * which recurses into its own SubagentCard — partitioning buckets grandchildren under the inner
 * task, so a plain tool row would silently drop them. The Task's own rawOutput is not repeated —
 * the transcript already ends with the subagent's report — except as the empty-transcript
 * fallback when a degraded/partial history does not contain that report. */
export function SubagentTranscript({
  toolCall,
  items,
  childrenByParent,
  awaitingApproval,
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
            return <ThoughtBlock key={item.id} blocks={item.blocks} isStreaming={false} />;
          case 'tool':
            if (item.toolCall.kind === 'task') {
              return (
                <SubagentCardContent
                  key={item.id}
                  awaitingApproval={awaitingApproval}
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
            return (
              <ToolCallItem
                key={item.id}
                awaitingApproval={awaitingApproval.has(item.toolCall.toolCallId)}
                constrainHeight={false}
                declined={declined.has(item.toolCall.toolCallId)}
                toolCall={item.toolCall}
                TerminalBlockComponent={TerminalBlockComponent}
              />
            );
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

/** Inline collapsible card for one subagent run: header shows the agent type + task description
 * and live status; the body nests the full transcript. Auto-open while running but the user's
 * toggle always wins (unlike ActivityGroup's forced-open) — a subagent can run for minutes. */
function SubagentCardContent({
  toolCall,
  items,
  childrenByParent,
  awaitingApproval,
  declined,
  TerminalBlockComponent,
  onExpand,
  constrainHeight,
}: SubagentCardProps & { constrainHeight: boolean }): React.ReactNode {
  const t = useTranslations('workbench.subagent');
  const tg = useTranslations('workbench.toolGroup');

  const isRunning = toolCall.status === 'in_progress' || toolCall.status === 'pending';
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? isRunning;

  const toolCount = items.reduce((count, item) => count + (item.kind === 'tool' ? 1 : 0), 0);
  const failedCount = items.reduce(
    (count, item) => count + (item.kind === 'tool' && item.toolCall.status === 'failed' ? 1 : 0),
    0,
  );
  const input = subagentTaskInput(toolCall.rawInput);

  return (
    <Collapsible className="w-full" onOpenChange={setManualOpen} open={open}>
      <div className="flex w-full items-center gap-2">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-sm">
          {isRunning ? (
            <Spinner className="size-3.5 shrink-0 text-foreground" />
          ) : (
            <BotIcon
              className={
                toolCall.status === 'failed'
                  ? 'size-3.5 shrink-0 text-destructive-foreground'
                  : 'size-3.5 shrink-0 text-muted-foreground'
              }
            />
          )}
          <span className="shrink-0 text-foreground">{input.subagentType ?? t('label')}</span>
          {toolCount > 0 ? (
            <Badge size="sm" variant="secondary">
              {t('steps', { count: toolCount })}
            </Badge>
          ) : null}
          {failedCount > 0 ? (
            <Badge size="sm" variant="error">
              {tg('failed', { count: failedCount })}
            </Badge>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
            {input.description ?? toolCall.title}
          </span>
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
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
      <CollapsibleContent
        className={cn(
          'mt-1 space-y-2 border-l-2 border-border pl-3',
          // Nested task cards share the root card's scroll container to avoid scroll traps.
          constrainHeight && TOOL_DETAIL_SCROLL_CLASS_NAME,
        )}
      >
        <SubagentTranscript
          awaitingApproval={awaitingApproval}
          childrenByParent={childrenByParent}
          declined={declined}
          items={items}
          onExpand={onExpand}
          TerminalBlockComponent={TerminalBlockComponent}
          toolCall={toolCall}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
