import type { ToolCall } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { ToolCaseIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { toolCallDiffStats } from '../diff-utils';
import { cn } from '../lib/cn';
import type { ToolMetadata } from '../tool-utils';
import {
  hasToolBody,
  mcpToolName,
  toolCallContextSummary,
  toolCallFailureMessage,
  toolCallMetadata,
  toolCallSearchCounts,
} from '../tool-utils';
import { Tool, ToolContent, ToolHeader } from './tool';
import { toolCallDisplayText, toolSearchPresentation } from './tool-result-content';
import { ToolResultPreview } from './tool-result-preview';

function ToolMetadataList({ metadata }: { metadata: ToolMetadata[] }): React.ReactNode {
  const t = useTranslations('workbench.tool');
  if (metadata.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {metadata.map((item) => (
        <Badge
          className="max-w-full gap-1.5 font-normal"
          key={`${item.key}:${item.label ?? ''}:${item.value}`}
          size="sm"
          variant={item.tone === 'error' ? 'error' : 'secondary'}
        >
          <span className="text-muted-foreground">{item.label ?? t(item.key)}</span>
          <code className="truncate">{item.value}</code>
        </Badge>
      ))}
    </div>
  );
}

/** The expandable detail of one call. Raw adapter payloads never render directly: known scalar
 * metadata is projected into badges, while structured content keeps its purpose-built surface. */
export function ToolCallBody({
  toolCall,
  TerminalBlockComponent,
}: {
  toolCall: ToolCall;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}): React.ReactNode {
  const contentText = toolCallDisplayText(toolCall);
  const rawFailureMessage =
    toolCall.kind === 'execute' ? undefined : toolCallFailureMessage(toolCall);
  const failureMessage =
    rawFailureMessage && !contentText.includes(rawFailureMessage) ? rawFailureMessage : undefined;
  const metadata = toolCall.kind === 'search' ? [] : toolCallMetadata(toolCall);

  return (
    <>
      <ToolMetadataList metadata={metadata} />
      <ToolResultPreview TerminalBlockComponent={TerminalBlockComponent} toolCall={toolCall} />

      {failureMessage ? (
        <p className="text-destructive-foreground text-sm">{failureMessage}</p>
      ) : null}
    </>
  );
}

export function ToolCallItem({
  toolCall,
  declined = false,
  awaitingApproval = false,
  awaitingAnswer = false,
  icon,
  TerminalBlockComponent,
  constrainHeight = true,
}: {
  toolCall: ToolCall;
  /** The user declined this call's gating permission (shown instead of a separate receipt row). */
  declined?: boolean;
  /** The call's gating permission is still awaiting an answer. */
  awaitingApproval?: boolean;
  /** The call's question is still awaiting the user's answer. */
  awaitingAnswer?: boolean;
  /** Custom glyph for plugin / MCP / custom tool calls. */
  icon?: React.ReactNode;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  /** Disable when a parent transcript owns the capped scroll container. */
  constrainHeight?: boolean;
}): React.ReactNode {
  const tp = useTranslations('workbench.permission');
  const tt = useTranslations('workbench.tool');

  const hasBody = hasToolBody(toolCall);
  const diffTotals = toolCallDiffStats(toolCall);
  const mcp = mcpToolName(toolCall.title);
  const running = !declined && (toolCall.status === 'pending' || toolCall.status === 'in_progress');
  const completed = !declined && toolCall.status === 'completed';

  // Search headers are humanized: ToolSearch gets a localized verb (never its raw select: query),
  // and other search calls summarize settle counts — raw patterns live only in the body card.
  const toolSearch = toolSearchPresentation(toolCall);
  const searchCounts = toolSearch ? undefined : toolCallSearchCounts(toolCall);
  let title = mcp?.tool ?? toolCall.title;
  let summary = toolCallContextSummary(toolCall);
  let headerIcon = icon;
  if (toolSearch && !headerIcon) {
    headerIcon = (
      <ToolCaseIcon
        className={cn('size-3.5 shrink-0', running ? 'text-foreground' : 'text-muted-foreground')}
      />
    );
  }
  if (toolSearch) {
    title =
      toolSearch.mode === 'select'
        ? running
          ? tt('toolSearch.selecting')
          : // History reads can lose the result rows (the SDK strips tool_use_result), so a
            // settle without names keeps the neutral label instead of "Selected 0 tools".
            completed && toolSearch.names.length > 0
            ? tt('toolSearch.selected', { count: toolSearch.names.length })
            : tt('toolSearch.select')
        : running
          ? tt('toolSearch.searching')
          : completed
            ? tt('toolSearch.searched')
            : tt('toolSearch.search');
    summary = toolSearch.mode === 'search' ? { label: toolSearch.query } : undefined;
  } else if (searchCounts) {
    const label = [
      searchCounts.matches === undefined
        ? undefined
        : tt('searchSummary.matches', { count: searchCounts.matches }),
      searchCounts.files === undefined
        ? undefined
        : tt('searchSummary.files', { count: searchCounts.files }),
    ]
      .filter((part) => part !== undefined)
      .join(' · ');
    summary = {
      label: summary ? `${summary.label} · ${label}` : label,
      tooltip: summary?.tooltip,
    };
  }

  return (
    <Tool>
      <ToolHeader
        awaitingApproval={awaitingApproval}
        awaitingAnswer={awaitingAnswer}
        declined={declined}
        diffStats={diffTotals}
        hasBody={hasBody}
        icon={headerIcon}
        kind={toolCall.kind}
        status={toolCall.status}
        statusLabel={
          awaitingApproval
            ? tp('reviewRequired')
            : declined
              ? tp('declined')
              : toolCall.status === 'failed'
                ? tt('failed')
                : undefined
        }
        summary={summary?.label === title ? undefined : summary?.label}
        title={title}
        tooltip={summary?.tooltip}
      />

      {hasBody && (
        <ToolContent constrainHeight={constrainHeight}>
          <ToolCallBody TerminalBlockComponent={TerminalBlockComponent} toolCall={toolCall} />
        </ToolContent>
      )}
    </Tool>
  );
}
