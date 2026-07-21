import type { ContentBlock } from '@linkcode/schema';
import { FileTextIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { fileBasename } from './artifacts/file-kind';
import { codeLanguageForResource } from './code-language';
import { FilePreviewCard } from './file-preview-card';
import { HighlightedCode } from './highlighted-code';
import { Markdown, SmoothMarkdown } from './markdown';

function resourceLabel(uri: string, fallback: string): string {
  const visible = uri.split('#', 1)[0]?.split('?', 1)[0] ?? '';
  if (visible.endsWith('/')) return fallback;
  const label = fileBasename(visible);
  return label && !label.includes(':') ? label : fallback;
}

export function ContentBlockView({
  block,
  smoothText = false,
  isStreaming = false,
}: {
  block: ContentBlock;
  smoothText?: boolean;
  isStreaming?: boolean;
}): React.ReactNode {
  const t = useTranslations('workbench.content');

  switch (block.type) {
    case 'text':
      return smoothText ? (
        <SmoothMarkdown isStreaming={isStreaming}>{block.text}</SmoothMarkdown>
      ) : (
        <Markdown>{block.text}</Markdown>
      );
    case 'image':
      return (
        <img
          alt=""
          className="my-2 max-h-80 max-w-full rounded-lg border border-border"
          src={block.uri ?? `data:${block.mimeType};base64,${block.data}`}
        />
      );
    case 'audio':
      return (
        // biome-ignore lint/a11y/useMediaCaption: agent-provided audio has no caption track
        <audio controls className="my-2 w-full" src={`data:${block.mimeType};base64,${block.data}`}>
          {t('audio')}
        </audio>
      );
    case 'resource_link':
      return (
        <a
          href={block.uri}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-sm text-foreground hover:opacity-80"
        >
          <FileTextIcon className="size-3.5" />
          {t('resourceLink', { name: block.name })}
        </a>
      );
    case 'resource': {
      const uri = block.resource.uri;
      const label = resourceLabel(uri, t('resource'));
      return 'text' in block.resource ? (
        <FilePreviewCard label={label} navigation={null} panelClassName="p-0" path={uri}>
          <HighlightedCode
            className="p-3"
            code={block.resource.text}
            language={codeLanguageForResource(uri, block.resource.mimeType)}
          />
        </FilePreviewCard>
      ) : (
        <FilePreviewCard label={label} navigation={null} path={uri} />
      );
    }
    default:
      return null;
  }
}
