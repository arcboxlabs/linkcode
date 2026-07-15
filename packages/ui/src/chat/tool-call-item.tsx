import type { ToolCall } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { useTranslations } from 'use-intl';
import { FileArtifactCard } from './artifacts/file-card';
import { toolCallDiffStats } from './diff-utils';
import { Tool, ToolContent, ToolHeader } from './tool';
import { toolCallDisplayText } from './tool-result-content';
import { ToolResultPreview } from './tool-result-preview';
import type { ToolMetadata } from './tool-utils';
import {
  hasToolBody,
  toolCallFailureMessage,
  toolCallMetadata,
  toolCallSummary,
} from './tool-utils';

const MAX_PRODUCED_FILE_CARDS = 4;

/** Files a completed move produced — edits keep their file context in the summary and diff. */
function producedFilePaths(toolCall: ToolCall): string[] {
  if (toolCall.status !== 'completed') return [];
  if (toolCall.kind !== 'move') return [];
  const paths = new Set<string>();
  for (const location of toolCall.locations ?? []) paths.add(location.path);
  for (const content of toolCall.content) {
    if (content.type === 'diff') paths.add(content.path);
  }
  return [...paths].slice(0, MAX_PRODUCED_FILE_CARDS);
}

function ToolMetadataList({ metadata }: { metadata: ToolMetadata[] }): React.ReactNode {
  const t = useTranslations('workbench.tool');
  if (metadata.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {metadata.map((item) => (
        <Badge
          className="max-w-full gap-1.5 font-normal"
          key={`${item.key}:${item.value}`}
          size="sm"
          variant={item.tone === 'error' ? 'error' : 'secondary'}
        >
          <span className="text-muted-foreground">{t(item.key)}</span>
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
  icon,
  TerminalBlockComponent,
  constrainHeight = true,
}: {
  toolCall: ToolCall;
  /** The user declined this call's gating permission (shown instead of a separate receipt row). */
  declined?: boolean;
  /** The call's gating permission is still awaiting an answer. */
  awaitingApproval?: boolean;
  /** Custom glyph for plugin / MCP / custom tool calls. */
  icon?: React.ReactNode;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
  /** Disable when a parent transcript owns the capped scroll container. */
  constrainHeight?: boolean;
}): React.ReactNode {
  const t = useTranslations('workbench.tool');
  const tp = useTranslations('workbench.permission');

  const kindKey = `kind${toolCall.kind[0].toUpperCase()}${toolCall.kind.slice(1)}`;
  const hasBody = hasToolBody(toolCall);
  const producedFiles = producedFilePaths(toolCall);
  const summary = toolCallSummary(toolCall);
  const diffTotals = toolCallDiffStats(toolCall);

  return (
    <Tool>
      <ToolHeader
        awaitingApproval={awaitingApproval}
        badge={t(kindKey)}
        declinedBadge={declined ? tp('declined') : undefined}
        diffStats={diffTotals}
        hasBody={hasBody}
        icon={icon}
        kind={toolCall.kind}
        status={toolCall.status}
        summary={summary === toolCall.title ? undefined : summary}
        title={toolCall.title}
      />

      {hasBody && (
        <ToolContent constrainHeight={constrainHeight}>
          <ToolCallBody TerminalBlockComponent={TerminalBlockComponent} toolCall={toolCall} />
        </ToolContent>
      )}

      {producedFiles.length > 0 && (
        <div className="mt-1">
          {producedFiles.map((path) => (
            <FileArtifactCard key={path} path={path} />
          ))}
        </div>
      )}
    </Tool>
  );
}
