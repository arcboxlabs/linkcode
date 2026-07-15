import type { ToolCall } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { useTranslations } from 'use-intl';
import { FileArtifactCard } from './artifacts/file-card';
import { ContentBlockView } from './content-block-view';
import { DiffBlock } from './diff-block';
import { toolCallDiffStats } from './diff-utils';
import { Terminal } from './terminal';
import { TerminalBlock } from './terminal-block';
import { Tool, ToolContent, ToolHeader } from './tool';
import type { ToolMetadata } from './tool-utils';
import {
  hasToolBody,
  toolCallCommand,
  toolCallFailureMessage,
  toolCallFallbackContent,
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

function executeOutput(
  toolCall: ToolCall,
  fallbackContent: ReturnType<typeof toolCallFallbackContent>,
): string | undefined {
  const text = [
    ...toolCall.content.flatMap((content) =>
      content.type === 'content' && content.content.type === 'text' ? [content.content.text] : [],
    ),
    ...fallbackContent.flatMap((content) => (content.type === 'text' ? [content.text] : [])),
  ].join('\n');
  if (text.length > 0) return text;
  if (toolCall.rawOutput === undefined) return undefined;
  if (typeof toolCall.rawOutput === 'string') return toolCall.rawOutput;
  if (
    typeof toolCall.rawOutput === 'object' &&
    toolCall.rawOutput !== null &&
    'message' in toolCall.rawOutput &&
    typeof toolCall.rawOutput.message === 'string'
  ) {
    return toolCall.rawOutput.message;
  }
  return undefined;
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

function ToolCallContentView({
  content,
  TerminalBlockComponent,
}: {
  content: ToolCall['content'][number];
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}): React.ReactNode {
  if (content.type === 'content') return <ContentBlockView block={content.content} />;
  if (content.type === 'diff') {
    return <DiffBlock path={content.path} oldText={content.oldText} newText={content.newText} />;
  }
  if (TerminalBlockComponent) {
    return <TerminalBlockComponent terminalId={content.terminalId} />;
  }
  return <TerminalBlock terminalId={content.terminalId} />;
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
  const fallbackContent = toolCallFallbackContent(toolCall);
  const isStaticExecute =
    toolCall.kind === 'execute' && toolCall.content.every((content) => content.type !== 'terminal');
  const contentText = [
    ...toolCall.content.flatMap((content) =>
      content.type === 'content' && content.content.type === 'text' ? [content.content.text] : [],
    ),
    ...fallbackContent.flatMap((content) => (content.type === 'text' ? [content.text] : [])),
  ].join('\n');
  const rawFailureMessage =
    toolCall.kind === 'execute' ? undefined : toolCallFailureMessage(toolCall);
  const failureMessage =
    rawFailureMessage && !contentText.includes(rawFailureMessage) ? rawFailureMessage : undefined;

  return (
    <>
      <ToolMetadataList metadata={toolCallMetadata(toolCall)} />

      {isStaticExecute ? (
        <Terminal
          title={toolCallCommand(toolCall) ?? toolCall.title}
          output={executeOutput(toolCall, fallbackContent)}
        />
      ) : null}

      {toolCall.content.map((content, index) => {
        if (isStaticExecute && content.type === 'content' && content.content.type === 'text') {
          return null;
        }
        // Tool content is a full snapshot replaced by id each event, so index+type is stable.
        const key = `${index}:${content.type}`;
        return (
          <ToolCallContentView
            key={key}
            TerminalBlockComponent={TerminalBlockComponent}
            content={content}
          />
        );
      })}

      {fallbackContent.map((content, index) => {
        if (isStaticExecute && content.type === 'text') return null;
        // eslint-disable-next-line @eslint-react/no-array-index-key -- raw result content is a full snapshot with no block ids; index+type is its stable position key
        return <ContentBlockView key={`${index}:${content.type}`} block={content} />;
      })}

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
}: {
  toolCall: ToolCall;
  /** The user declined this call's gating permission (shown instead of a separate receipt row). */
  declined?: boolean;
  /** The call's gating permission is still awaiting an answer. */
  awaitingApproval?: boolean;
  /** Custom glyph for plugin / MCP / custom tool calls. */
  icon?: React.ReactNode;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
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
        <ToolContent>
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
