import { Badge } from 'coss-ui/components/badge';
import { Dialog, DialogPopup, DialogTitle } from 'coss-ui/components/dialog';
import { Spinner } from 'coss-ui/components/spinner';
import { BotIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import type { ToolTimelineItem } from './activity-groups';
import { SubagentTranscript, subagentTaskInput } from './subagent-card';
import type { ConversationItem } from './types';

export interface SubagentViewerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every subagent spawn (`task`-kind tool item) in the conversation, timeline order. */
  tasks: readonly ToolTimelineItem[];
  selectedId: string | null;
  onSelect: (toolCallId: string) => void;
  childrenByParent: ReadonlyMap<string, ConversationItem[]>;
  awaitingApproval: ReadonlySet<string>;
  declined: ReadonlySet<string>;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}

/** Full-size transcript viewer (the TUI's task view): a rail listing every subagent in the
 * conversation, the selected one's transcript beside it at reading width. */
export function SubagentViewer({
  open,
  onOpenChange,
  tasks,
  selectedId,
  onSelect,
  childrenByParent,
  awaitingApproval,
  declined,
  TerminalBlockComponent,
}: SubagentViewerProps): React.ReactNode {
  const t = useTranslations('workbench.subagent');

  // eslint-disable-next-line sukka/react-no-performance-impacting-array-find -- a conversation holds a handful of subagents at most; a lookup Map would outweigh the scan
  const selected = tasks.find((task) => task.toolCall.toolCallId === selectedId) ?? tasks[0];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="h-[80vh] max-w-5xl">
        <div className="flex min-h-0 flex-1">
          <div className="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-e border-border p-3">
            <DialogTitle className="px-2 pt-1 pb-2 text-sm">{t('viewerTitle')}</DialogTitle>
            {tasks.length === 0 ? (
              <div className="px-2 text-muted-foreground text-sm">{t('empty')}</div>
            ) : (
              tasks.map((task) => (
                <SubagentRailRow
                  key={task.id}
                  onSelect={onSelect}
                  selected={task.toolCall.toolCallId === selected?.toolCall.toolCallId}
                  task={task}
                />
              ))
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2 overflow-y-auto p-4">
            {selected ? (
              <SubagentTranscript
                awaitingApproval={awaitingApproval}
                childrenByParent={childrenByParent}
                declined={declined}
                items={childrenByParent.get(selected.toolCall.toolCallId) ?? []}
                // A nested spawn's expand button re-targets the rail selection to that subagent.
                onExpand={onSelect}
                TerminalBlockComponent={TerminalBlockComponent}
                toolCall={selected.toolCall}
              />
            ) : null}
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function SubagentRailRow({
  task,
  selected,
  onSelect,
}: {
  task: ToolTimelineItem;
  selected: boolean;
  onSelect: (toolCallId: string) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.subagent');
  const toolCall = task.toolCall;
  const isRunning = toolCall.status === 'in_progress' || toolCall.status === 'pending';
  const input = subagentTaskInput(toolCall.rawInput);

  return (
    <button
      className={cn(
        'flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted',
        selected && 'bg-muted',
      )}
      onClick={() => onSelect(toolCall.toolCallId)}
      type="button"
    >
      <span className="flex items-center gap-1.5">
        {isRunning ? (
          <Spinner className="size-3.5 shrink-0" />
        ) : (
          <BotIcon
            className={cn(
              'size-3.5 shrink-0',
              toolCall.status === 'failed'
                ? 'text-destructive-foreground'
                : 'text-muted-foreground',
            )}
          />
        )}
        <span className="min-w-0 truncate font-medium">{input.subagentType ?? t('label')}</span>
        {toolCall.status === 'failed' ? (
          <Badge size="sm" variant="error">
            {t('failedBadge')}
          </Badge>
        ) : null}
      </span>
      <span className="truncate text-muted-foreground text-xs">
        {input.description ?? toolCall.title}
      </span>
    </button>
  );
}
