import type { ToolCall } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { Spinner } from 'coss-ui/components/spinner';
import { BotIcon, ChevronRightIcon, Maximize2Icon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { ContentBlockView } from './content-block-view';
import { Message, MessageContent } from './message';
import { ThoughtBlock } from './thought-block';
import { ToolCallBody, ToolCallItem } from './tool-call-item';
import type { ConversationItem } from './types';

export interface SubagentTaskInput {
  description?: string;
  subagentType?: string;
}

/** The Task tool's input fields the header displays (see the SDK's `AgentInput`). */
export function subagentTaskInput(rawInput: unknown): SubagentTaskInput {
  if (typeof rawInput !== 'object' || rawInput === null || Array.isArray(rawInput)) return {};
  const raw = rawInput as Record<string, unknown>;
  return {
    description: typeof raw.description === 'string' ? raw.description : undefined,
    subagentType: typeof raw.subagent_type === 'string' ? raw.subagent_type : undefined,
  };
}

interface SubagentTranscriptProps {
  /** The spawning `task`-kind tool call. */
  toolCall: ToolCall;
  /** The subagent's items (narration / reasoning / tool calls), in arrival order. */
  items: readonly ConversationItem[];
  awaitingApproval: ReadonlySet<string>;
  declined: ReadonlySet<string>;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}

/** The nested transcript body, shared between the inline card and the full-size viewer. Children
 * render linearly (no recursive activity grouping); the Task's own rawOutput is not repeated —
 * the transcript already ends with the subagent's report — except as the empty-transcript
 * fallback (e.g. a degraded history read), so the report is never lost. */
export function SubagentTranscript({
  toolCall,
  items,
  awaitingApproval,
  declined,
  TerminalBlockComponent,
}: SubagentTranscriptProps): React.ReactNode {
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
                  {item.blocks.map((block, index) => (
                    // eslint-disable-next-line @eslint-react/no-array-index-key -- append-only stream: index+type is a stable position key
                    <ContentBlockView key={`${index}:${block.type}`} block={block} />
                  ))}
                </MessageContent>
              </Message>
            );
          case 'reasoning':
            return <ThoughtBlock key={item.id} blocks={item.blocks} isStreaming={false} />;
          case 'tool':
            return (
              <ToolCallItem
                key={item.id}
                awaitingApproval={awaitingApproval.has(item.toolCall.toolCallId)}
                declined={declined.has(item.toolCall.toolCallId)}
                toolCall={item.toolCall}
                TerminalBlockComponent={TerminalBlockComponent}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}

export interface SubagentCardProps extends SubagentTranscriptProps {
  /** Opens the full-size transcript viewer for this subagent. */
  onExpand?: (toolCallId: string) => void;
}

/** Inline collapsible card for one subagent run: header shows the agent type + task description
 * and live status; the body nests the full transcript. Auto-open while running but the user's
 * toggle always wins (unlike ActivityGroup's forced-open) — a subagent can run for minutes. */
export function SubagentCard({
  toolCall,
  items,
  awaitingApproval,
  declined,
  TerminalBlockComponent,
  onExpand,
}: SubagentCardProps): React.ReactNode {
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
          <button
            aria-label={t('viewTranscript')}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => onExpand(toolCall.toolCallId)}
            title={t('viewTranscript')}
            type="button"
          >
            <Maximize2Icon className="size-3.5" />
          </button>
        ) : null}
      </div>
      <CollapsibleContent className="mt-1 space-y-2 border-l-2 border-border pl-3">
        <SubagentTranscript
          awaitingApproval={awaitingApproval}
          declined={declined}
          items={items}
          TerminalBlockComponent={TerminalBlockComponent}
          toolCall={toolCall}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}
