import type { ToolCall, ToolCallContent } from '@linkcode/schema';
import { FileTextIcon, GlobeIcon, TextSearchIcon, WrenchIcon } from 'lucide-react';
import { Fragment } from 'react';
import { toolCallCommand, toolCallDisplayTitle } from '../tool-utils';
import { artifactKindForPath, fileExtension } from './artifacts/file-kind';
import { CodeBlock } from './code-block';
import { ContentBlockView } from './content-block-view';
import { contentDerivedEntries } from './content-derived-keys';
import { DiffBlock } from './diff-block';
import { FilePreviewCard } from './file-preview-card';
import type { ToolCallFilePresentation } from './file-tool-presentation';
import { toolCallDiffNavigation, toolCallFilePresentation } from './file-tool-presentation';
import { HighlightedCode } from './highlighted-code';
import { Markdown } from './markdown';
import { Terminal } from './terminal';
import { TerminalBlock } from './terminal-block';
import { ToolPreviewCard } from './tool-preview-card';
import {
  toolCallDisplayContent,
  toolCallExecuteText,
  toolCallFetchStatus,
  toolCallFetchUrl,
  toolCallReadPreviewText,
  toolCallSearchQuery,
  toolSearchPresentation,
} from './tool-result-content';
import { ToolSearchResult } from './tool-search';

/** Host-provided replacement for the static `TerminalBlock` (e.g. the live daemon-backed one). */
export type TerminalBlockComponent = React.ComponentType<{
  terminalId: string;
  command?: string;
}>;

interface ToolResultPreviewProps {
  toolCall: ToolCall;
  TerminalBlockComponent?: TerminalBlockComponent;
}

function RenderedContent({
  content,
  TerminalBlockComponent,
  toolCall,
}: {
  content: ToolCallContent;
  TerminalBlockComponent?: TerminalBlockComponent;
  toolCall: ToolCall;
}): React.ReactNode {
  if (content.type === 'content') return <ContentBlockView block={content.content} />;
  if (content.type === 'diff') {
    return <DiffBlock content={content} navigation={toolCallDiffNavigation(toolCall, content)} />;
  }
  const command = toolCallCommand(toolCall);
  if (TerminalBlockComponent) {
    return <TerminalBlockComponent command={command} terminalId={content.terminalId} />;
  }
  return <TerminalBlock command={command} terminalId={content.terminalId} />;
}

/** The expanded card is the raw query's only home — headers summarize counts instead. */
function SearchRows({ toolCall, text }: { toolCall: ToolCall; text: string }): React.ReactNode {
  // Search adapters return paths, grep-style lines, or prose. Preserve their text as one node:
  // splitting an unbounded grep result into rows can freeze the Electron renderer.
  return (
    <ToolPreviewCard
      icon={TextSearchIcon}
      title={toolCallSearchQuery(toolCall) ?? toolCallDisplayTitle(toolCall)}
    >
      {text ? (
        <pre className="overflow-x-auto whitespace-pre font-mono text-xs leading-relaxed">
          <code>{text}</code>
        </pre>
      ) : null}
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

function FileCallText({
  file,
  text,
  toolCall,
}: {
  file: ToolCallFilePresentation;
  text: string;
  toolCall: ToolCall;
}): React.ReactNode {
  if (toolCall.kind !== 'read') return <Markdown>{text}</Markdown>;

  const previewText = file.ambiguous ? text : toolCallReadPreviewText(toolCall, text);
  if (!file.ambiguous && artifactKindForPath(file.path) === 'markdown') {
    return <Markdown>{previewText}</Markdown>;
  }
  return (
    <HighlightedCode
      code={previewText}
      language={file.ambiguous ? undefined : fileExtension(file.path)}
    />
  );
}

/** File reads share one identity/navigation header across every returned content block. */
function FileCallPreview({
  content,
  file,
  TerminalBlockComponent,
  toolCall,
}: ToolResultPreviewProps & {
  content: readonly ToolCallContent[];
  file: ToolCallFilePresentation;
}): React.ReactNode {
  const badge =
    toolCall.kind === 'read' && !file.ambiguous ? fileExtension(file.path) || undefined : undefined;

  return (
    <FilePreviewCard
      badge={badge}
      label={file.label}
      navigation={file.navigation ?? null}
      path={file.path}
      tooltip={file.tooltip}
    >
      {content.length === 0
        ? undefined
        : contentDerivedEntries(content).map(({ item, key }) => (
            <div key={key}>
              {item.type === 'content' && item.content.type === 'text' ? (
                <FileCallText file={file} text={item.content.text} toolCall={toolCall} />
              ) : (
                <RenderedContent
                  content={item}
                  TerminalBlockComponent={TerminalBlockComponent}
                  toolCall={toolCall}
                />
              )}
            </div>
          ))}
    </FilePreviewCard>
  );
}

/** Mutation result text is a receipt or warning, not a snapshot of the touched file. */
function FileMutationPreview({
  content,
  file,
  TerminalBlockComponent,
  toolCall,
}: ToolResultPreviewProps & {
  content: readonly ToolCallContent[];
  file: ToolCallFilePresentation;
}): React.ReactNode {
  const receiptContent = content.filter((item) => item.type !== 'diff');
  const firstReceipt = receiptContent[0];
  const hasDiff = content.some((item) => item.type === 'diff');

  if (content.length === 0) {
    return (
      <FilePreviewCard
        label={file.label}
        navigation={file.navigation ?? null}
        path={file.path}
        tooltip={file.tooltip}
      />
    );
  }

  return contentDerivedEntries(content).map(({ item, key }) => {
    if (item.type === 'diff') {
      return (
        <div key={key}>
          <RenderedContent
            content={item}
            TerminalBlockComponent={TerminalBlockComponent}
            toolCall={toolCall}
          />
        </div>
      );
    }
    if (item !== firstReceipt) return null;
    return (
      <Fragment key={`${toolCall.toolCallId}:receipts`}>
        {!hasDiff || file.ambiguous ? (
          <FilePreviewCard
            label={file.label}
            navigation={file.navigation ?? null}
            path={file.path}
            tooltip={file.tooltip}
          />
        ) : null}
        <ContentList
          content={receiptContent}
          toolCall={toolCall}
          TerminalBlockComponent={TerminalBlockComponent}
        />
      </Fragment>
    );
  });
}

function renderTextPreview(toolCall: ToolCall, text: string): React.ReactNode {
  const displayTitle = toolCallDisplayTitle(toolCall);
  switch (toolCall.kind) {
    case 'read': {
      return (
        <ToolPreviewCard icon={FileTextIcon} title={displayTitle}>
          <HighlightedCode code={text} />
        </ToolPreviewCard>
      );
    }
    case 'search':
      return <SearchRows text={text} toolCall={toolCall} />;
    case 'fetch': {
      const title = toolCallFetchUrl(toolCall) ?? displayTitle;
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
        <CodeBlock code={json} language="json" title={displayTitle} />
      ) : (
        <ToolPreviewCard icon={WrenchIcon} title={displayTitle}>
          <Markdown>{text}</Markdown>
        </ToolPreviewCard>
      );
    }
    // Mutation receipts and reasoning summaries are auxiliary prose, not artifacts — no card.
    case 'edit':
    case 'delete':
    case 'move':
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
  return contentDerivedEntries(content).map(({ item, key }) => (
    <div key={key}>
      {item.type === 'content' && item.content.type === 'text' ? (
        renderTextPreview(toolCall, item.content.text)
      ) : (
        <RenderedContent
          content={item}
          TerminalBlockComponent={TerminalBlockComponent}
          toolCall={toolCall}
        />
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
      {contentDerivedEntries(terminalContent).map(({ item, key }) => (
        <RenderedContent
          key={key}
          content={item}
          TerminalBlockComponent={TerminalBlockComponent}
          toolCall={toolCall}
        />
      ))}
      {output || terminalContent.length === 0 ? (
        <Terminal
          title={toolCallCommand(toolCall) ?? toolCallDisplayTitle(toolCall)}
          output={output}
        />
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
  const toolSearch = toolSearchPresentation(toolCall);
  if (toolSearch) return <ToolSearchResult presentation={toolSearch} />;
  const content = toolCallDisplayContent(toolCall);
  if (toolCall.kind === 'search' && content.length === 0 && toolCallSearchQuery(toolCall)) {
    return <SearchRows text="" toolCall={toolCall} />;
  }
  const file = toolCallFilePresentation(toolCall);
  if (file) {
    const hasDiff = content.some((item) => item.type === 'diff');
    if (!hasDiff && toolCall.kind === 'read') {
      return (
        <FileCallPreview
          content={content}
          file={file}
          toolCall={toolCall}
          TerminalBlockComponent={TerminalBlockComponent}
        />
      );
    }
    if (toolCall.kind !== 'read') {
      return (
        <FileMutationPreview
          content={content}
          file={file}
          toolCall={toolCall}
          TerminalBlockComponent={TerminalBlockComponent}
        />
      );
    }
  }
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
