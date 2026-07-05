import type { ToolCall } from '@linkcode/schema';
import { useTranslations } from 'use-intl';
import { FileArtifactCard } from './artifacts/file-card';
import { ContentBlockView } from './content-block-view';
import { DiffBlock } from './diff-block';
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

/** The expandable detail of one call — input, content blocks / diffs / terminals, raw output. */
export function ToolCallBody({
  toolCall,
  TerminalBlockComponent,
}: {
  toolCall: ToolCall;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}): React.ReactNode {
  const t = useTranslations('workbench.tool');

  return (
    <>
      {toolCall.rawInput !== undefined && (
        <ToolSection label={t('input')}>
          <ToolJson value={toolCall.rawInput} />
        </ToolSection>
      )}

      {toolCall.content.map((c, index) => {
        // Tool content is a full snapshot replaced by id each event, so index+type is a stable key.
        const key = `${index}:${c.type}`;
        if (c.type === 'content') {
          return <ContentBlockView key={key} block={c.content} />;
        }
        if (c.type === 'diff') {
          return <DiffBlock key={key} path={c.path} oldText={c.oldText} newText={c.newText} />;
        }
        if (TerminalBlockComponent) {
          return <TerminalBlockComponent key={key} terminalId={c.terminalId} />;
        }
        return <TerminalBlock key={key} terminalId={c.terminalId} />;
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
