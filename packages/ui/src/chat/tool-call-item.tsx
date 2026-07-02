import type { ToolCall } from '@linkcode/schema';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { ContentBlockView } from './content-block-view';
import { DiffBlock } from './diff-block';
import { TerminalBlock } from './terminal-block';
import { Tool, ToolContent, ToolHeader, ToolJson, ToolSection } from './tool';

export function ToolCallItem({
  toolCall,
  TerminalBlockComponent,
}: {
  toolCall: ToolCall;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}): React.ReactNode {
  const t = useTranslations('workbench.tool');
  const [open, setOpen] = useState(false);

  const kindKey = `kind${toolCall.kind[0].toUpperCase()}${toolCall.kind.slice(1)}`;
  const hasBody = Boolean(
    toolCall.content.length || toolCall.rawInput !== undefined || toolCall.rawOutput !== undefined,
  );

  return (
    <Tool onOpenChange={setOpen} open={open}>
      <ToolHeader
        badge={t(kindKey)}
        hasBody={hasBody}
        kind={toolCall.kind}
        open={open}
        status={toolCall.status}
        title={toolCall.title}
      />

      {open && hasBody && (
        <ToolContent>
          {toolCall.rawInput !== undefined && (
            <ToolSection label={t('input')}>
              <ToolJson value={toolCall.rawInput} />
            </ToolSection>
          )}

          {toolCall.content.map((c, index) => {
            // tool content is regenerated in stable order, never reordered: index+type is a stable position key
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
        </ToolContent>
      )}
    </Tool>
  );
}
