import type { ToolCall } from '@linkcode/schema';
import { useTranslations } from 'use-intl';
import { FileArtifactCard } from './artifacts/file-card';
import { ContentBlockView } from './content-block-view';
import { DiffBlock } from './diff-block';
import { Terminal } from './terminal';
import { TerminalBlock } from './terminal-block';
import { Tool, ToolContent, ToolHeader, ToolJson, ToolSection } from './tool';
import { hasToolBody } from './tool-utils';

const MAX_PRODUCED_FILE_CARDS = 4;

/** Files a completed write-class tool produced — these get artifact cards under the tool row. */
function producedFilePaths(toolCall: ToolCall): string[] {
  if (toolCall.status !== 'completed') return [];
  if (toolCall.kind !== 'edit' && toolCall.kind !== 'move') return [];
  const paths = new Set<string>();
  for (const location of toolCall.locations ?? []) paths.add(location.path);
  for (const content of toolCall.content) {
    if (content.type === 'diff') paths.add(content.path);
  }
  return [...paths].slice(0, MAX_PRODUCED_FILE_CARDS);
}

function executeCommand(toolCall: ToolCall): string {
  const input = toolCall.rawInput;
  if (typeof input !== 'object' || input === null) return toolCall.title;

  const command = 'command' in input ? input.command : 'cmd' in input ? input.cmd : undefined;
  if (typeof command === 'string' && command.length > 0) return command;
  if (Array.isArray(command) && command.every((part) => typeof part === 'string')) {
    return command.join(' ');
  }
  return toolCall.title;
}

function executeOutput(toolCall: ToolCall): string | undefined {
  const text = toolCall.content
    .flatMap((content) =>
      content.type === 'content' && content.content.type === 'text' ? [content.content.text] : [],
    )
    .join('\n');
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
  return JSON.stringify(toolCall.rawOutput, null, 2);
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

/** The expandable detail of one call. Static execute output uses the read-only terminal surface;
 * live terminal references and other tool kinds keep their structured presentation. */
export function ToolCallBody({
  toolCall,
  TerminalBlockComponent,
}: {
  toolCall: ToolCall;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}): React.ReactNode {
  const t = useTranslations('workbench.tool');
  const isStaticExecute =
    toolCall.kind === 'execute' && toolCall.content.every((content) => content.type !== 'terminal');

  if (isStaticExecute) {
    return (
      <>
        <Terminal title={executeCommand(toolCall)} output={executeOutput(toolCall)} />
        {toolCall.content.map((content, index) => {
          if (content.type === 'content' && content.content.type === 'text') return null;
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
      </>
    );
  }

  return (
    <>
      {toolCall.rawInput !== undefined && (
        <ToolSection label={t('input')}>
          <ToolJson value={toolCall.rawInput} />
        </ToolSection>
      )}

      {toolCall.content.map((content, index) => {
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

      {toolCall.content.length === 0 && toolCall.rawOutput !== undefined && (
        <ToolSection label={t('output')}>
          <ToolJson value={toolCall.rawOutput} />
        </ToolSection>
      )}
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

  return (
    <Tool>
      <ToolHeader
        awaitingApproval={awaitingApproval}
        badge={t(kindKey)}
        declinedBadge={declined ? tp('declined') : undefined}
        hasBody={hasBody}
        icon={icon}
        kind={toolCall.kind}
        status={toolCall.status}
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
