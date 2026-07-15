import type { ToolCall, ToolCallContent } from '@linkcode/schema';
import { FileTextIcon, GlobeIcon, SearchIcon, WrenchIcon } from 'lucide-react';
import { artifactKindForPath, fileExtension } from './artifacts/file-kind';
import { CodeBlock } from './code-block';
import { ContentBlockView } from './content-block-view';
import { DiffBlock } from './diff-block';
import { Markdown } from './markdown';
import { Terminal } from './terminal';
import { TerminalBlock } from './terminal-block';
import { ToolPreviewCard } from './tool-preview-card';
import {
  toolCallDisplayContent,
  toolCallExecuteText,
  toolCallFetchStatus,
  toolCallFetchUrl,
  toolCallFilePath,
  toolCallSearchQuery,
} from './tool-result-content';
import { TOOL_KIND_ICONS, toolCallCommand } from './tool-utils';

interface ToolResultPreviewProps {
  toolCall: ToolCall;
  TerminalBlockComponent?: React.ComponentType<{ terminalId: string }>;
}

function RenderedContent({
  content,
  TerminalBlockComponent,
}: {
  content: ToolCallContent;
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

function SearchRows({ toolCall, text }: { toolCall: ToolCall; text: string }): React.ReactNode {
  let resultCount = 0;
  let lineStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.codePointAt(index) !== 10) continue;
    if (index > lineStart) resultCount += 1;
    lineStart = index + 1;
  }
  if (lineStart < text.length) resultCount += 1;
  // Search adapters return paths, grep-style lines, or prose. Preserve their text as one node:
  // splitting an unbounded grep result into rows can freeze the Electron renderer.
  return (
    <ToolPreviewCard
      badge={String(resultCount)}
      icon={SearchIcon}
      title={toolCallSearchQuery(toolCall) ?? toolCall.title}
    >
      <pre className="overflow-x-auto whitespace-pre font-mono text-xs leading-relaxed">
        <code>{text}</code>
      </pre>
    </ToolPreviewCard>
  );
}

function formattedJson(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return undefined;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return undefined;
  }
}

function markupLanguage(text: string): 'html' | 'xml' | undefined {
  const trimmed = text.trimStart().toLowerCase();
  if (trimmed[0] !== '<') return undefined;
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') ? 'html' : 'xml';
}

function renderTextPreview(toolCall: ToolCall, text: string): React.ReactNode {
  switch (toolCall.kind) {
    case 'read': {
      const path = toolCallFilePath(toolCall) ?? toolCall.title;
      const language = fileExtension(path) || undefined;
      return artifactKindForPath(path) === 'markdown' ? (
        <ToolPreviewCard badge={language} icon={FileTextIcon} title={path}>
          <Markdown>{text}</Markdown>
        </ToolPreviewCard>
      ) : (
        <CodeBlock code={text} language={language} title={path} />
      );
    }
    case 'edit':
    case 'delete':
    case 'move': {
      const Icon = TOOL_KIND_ICONS[toolCall.kind];
      return (
        <ToolPreviewCard icon={Icon} title={toolCallFilePath(toolCall) ?? toolCall.title}>
          <Markdown>{text}</Markdown>
        </ToolPreviewCard>
      );
    }
    case 'search':
      return <SearchRows text={text} toolCall={toolCall} />;
    case 'fetch': {
      const title = toolCallFetchUrl(toolCall) ?? toolCall.title;
      const json = formattedJson(text);
      if (json) return <CodeBlock code={json} language="json" title={title} />;
      const markup = markupLanguage(text);
      if (markup) return <CodeBlock code={text} language={markup} title={title} />;
      return (
        <ToolPreviewCard badge={toolCallFetchStatus(toolCall)} icon={GlobeIcon} title={title}>
          <Markdown>{text}</Markdown>
        </ToolPreviewCard>
      );
    }
    case 'other': {
      const json = formattedJson(text);
      return json ? (
        <CodeBlock code={json} language="json" title={toolCall.title} />
      ) : (
        <ToolPreviewCard icon={WrenchIcon} title={toolCall.title}>
          <Markdown>{text}</Markdown>
        </ToolPreviewCard>
      );
    }
    case 'think':
    case 'task':
      return <Markdown>{text}</Markdown>;
    case 'execute':
      return null;
    default:
      return toolCall.kind satisfies never;
  }
}

function ContentList({
  toolCall,
  content,
  TerminalBlockComponent,
}: ToolResultPreviewProps & { content: readonly ToolCallContent[] }): React.ReactNode {
  return content.map((item, index) => (
    <div
      // eslint-disable-next-line @eslint-react/no-array-index-key -- tool content is a full ordered snapshot without block ids
      key={`${index}:${item.type}`}
    >
      {item.type === 'content' && item.content.type === 'text' ? (
        renderTextPreview(toolCall, item.content.text)
      ) : (
        <RenderedContent content={item} TerminalBlockComponent={TerminalBlockComponent} />
      )}
    </div>
  ));
}

function ExecutePreview({
  toolCall,
  content,
  TerminalBlockComponent,
}: ToolResultPreviewProps & { content: readonly ToolCallContent[] }): React.ReactNode {
  const terminalContent = content.filter((item) => item.type === 'terminal');
  const otherContent = content.filter(
    (item) => item.type !== 'terminal' && (item.type !== 'content' || item.content.type !== 'text'),
  );
  const output = toolCallExecuteText(toolCall);

  return (
    <>
      {terminalContent.map((item, index) => (
        <RenderedContent
          // eslint-disable-next-line @eslint-react/no-array-index-key -- terminal references are an ordered full snapshot without block ids
          key={`${index}:${item.type}`}
          content={item}
          TerminalBlockComponent={TerminalBlockComponent}
        />
      ))}
      {terminalContent.length === 0 || output ? (
        <Terminal title={toolCallCommand(toolCall) ?? toolCall.title} output={output} />
      ) : null}
      <ContentList
        content={otherContent}
        toolCall={toolCall}
        TerminalBlockComponent={TerminalBlockComponent}
      />
    </>
  );
}

/** Kind-aware result boundary: each action renders through a purpose-built, read-only surface. */
export function ToolResultPreview({
  toolCall,
  TerminalBlockComponent,
}: ToolResultPreviewProps): React.ReactNode {
  const content = toolCallDisplayContent(toolCall);
  return toolCall.kind === 'execute' ? (
    <ExecutePreview
      content={content}
      toolCall={toolCall}
      TerminalBlockComponent={TerminalBlockComponent}
    />
  ) : (
    <ContentList
      content={content}
      toolCall={toolCall}
      TerminalBlockComponent={TerminalBlockComponent}
    />
  );
}
