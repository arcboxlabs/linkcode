import type { ToolCall } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Spinner } from 'coss-ui/components/spinner';
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleIcon,
  CircleXIcon,
  PencilIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { ContentBlockView } from './content-block-view';
import { keyedItems, stableContentKey } from './content-keys';
import { DiffBlock } from './diff-block';
import { TerminalBlock } from './terminal-block';

export function ToolCallItem({ toolCall }: { toolCall: ToolCall }): ReactNode {
  const t = useTranslations('workbench.tool');
  const [open, setOpen] = useState(false);

  const kindKey = `kind${toolCall.kind[0].toUpperCase()}${toolCall.kind.slice(1)}`;
  const hasBody = Boolean(
    toolCall.content.length || toolCall.rawInput !== undefined || toolCall.rawOutput !== undefined,
  );
  let statusIcon: ReactNode;
  switch (toolCall.status) {
    case 'pending':
      statusIcon = <CircleIcon className="size-4 text-muted-foreground/60" />;
      break;
    case 'in_progress':
      statusIcon = <Spinner className="size-4 text-foreground" />;
      break;
    case 'completed':
      statusIcon =
        toolCall.kind === 'edit' || toolCall.kind === 'delete' ? (
          <PencilIcon className="size-4 text-foreground" />
        ) : (
          <CircleCheckIcon className="size-4 text-success-foreground" />
        );
      break;
    case 'failed':
      statusIcon = <CircleXIcon className="size-4 text-destructive-foreground" />;
      break;
    default:
      statusIcon = <CircleIcon className="size-4 text-muted-foreground/60" />;
      break;
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        className="group flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[13px] hover:bg-muted"
      >
        {statusIcon}
        <span className="min-w-0 flex-1 truncate text-foreground">{toolCall.title}</span>
        <Badge variant="secondary">{t(kindKey)}</Badge>
        {hasBody && (
          <ChevronRightIcon
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
        )}
      </button>

      {open && hasBody && (
        <div className="mt-1 ml-1 space-y-2 border-l-2 border-border pl-3">
          {toolCall.rawInput !== undefined && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {t('input')}
              </div>
              <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[12px]">
                {JSON.stringify(toolCall.rawInput, null, 2)}
              </pre>
            </div>
          )}

          {keyedItems(toolCall.content, stableContentKey).map(({ key, item: c }) => {
            if (c.type === 'content') {
              return <ContentBlockView key={key} block={c.content} />;
            }
            if (c.type === 'diff') {
              return <DiffBlock key={key} path={c.path} oldText={c.oldText} newText={c.newText} />;
            }
            return <TerminalBlock key={key} terminalId={c.terminalId} />;
          })}

          {toolCall.content.length === 0 && toolCall.rawOutput !== undefined && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {t('output')}
              </div>
              <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-[12px]">
                {typeof toolCall.rawOutput === 'string'
                  ? toolCall.rawOutput
                  : JSON.stringify(toolCall.rawOutput, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
