import type { ToolCall } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { useTranslations } from 'use-intl';
import { toolCallDiffStats } from './diff-utils';
import { Tool, ToolContent, ToolHeader } from './tool';
import { toolCallDisplayText } from './tool-result-content';
import { ToolResultPreview } from './tool-result-preview';
import type { ToolMetadata } from './tool-utils';
import {
  hasToolBody,
  mcpToolName,
  toolCallContextSummary,
  toolCallFailureMessage,
  toolCallMetadata,
} from './tool-utils';

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

  return (
    <>
      <ToolMetadataList metadata={toolCallMetadata(toolCall)} />
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
  const summary = toolCallContextSummary(toolCall);
  const diffTotals = toolCallDiffStats(toolCall);
  const mcp = mcpToolName(toolCall.title);
  const title = mcp?.tool ?? toolCall.title;

  return (
    <Tool>
      <ToolHeader
        awaitingApproval={awaitingApproval}
        awaitingAnswer={awaitingAnswer}
        declined={declined}
        diffStats={diffTotals}
        hasBody={hasBody}
        icon={icon}
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
