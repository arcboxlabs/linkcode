import type { ToolCall } from '@linkcode/schema';
import { useTranslations } from 'use-intl';
import { ContentBlockView } from './content-block-view';
import { keyedItems, stableContentKey } from './content-keys';
import { DiffBlock } from './diff-block';
import { TerminalBlock } from './terminal-block';
import { Tool, ToolContent, ToolHeader, ToolJson, ToolSection } from './tool';

export function hasToolBody(toolCall: ToolCall): boolean {
  return Boolean(
    toolCall.content.length || toolCall.rawInput !== undefined || toolCall.rawOutput !== undefined,
  );
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

      {keyedItems(toolCall.content, stableContentKey).map(({ key, item: c }) => {
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
  TerminalBlockComponent,
}: {
  toolCall: ToolCall;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}): React.ReactNode {
  const t = useTranslations('workbench.tool');

  const kindKey = `kind${toolCall.kind[0].toUpperCase()}${toolCall.kind.slice(1)}`;
  const hasBody = hasToolBody(toolCall);

  return (
    <Tool>
      <ToolHeader
        badge={t(kindKey)}
        hasBody={hasBody}
        kind={toolCall.kind}
        status={toolCall.status}
        title={toolCall.title}
      />

      {hasBody && (
        <ToolContent>
          <ToolCallBody TerminalBlockComponent={TerminalBlockComponent} toolCall={toolCall} />
        </ToolContent>
      )}
    </Tool>
  );
}
