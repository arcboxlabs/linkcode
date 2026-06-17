import type { ContentBlock } from '@linkcode/schema';
import { FileTextIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { useTranslations } from 'use-intl';
import { Markdown } from './Markdown';

export function ContentBlockView({ block }: { block: ContentBlock }): ReactElement {
  const t = useTranslations('workbench.content');

  switch (block.type) {
    case 'text':
      return <Markdown>{block.text}</Markdown>;
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
          className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[13px] text-foreground hover:opacity-80"
        >
          <FileTextIcon className="size-3.5" />
          {t('resourceLink', { name: block.name })}
        </a>
      );
    case 'resource':
      return 'text' in block.resource ? (
        <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[12.5px]">
          {block.resource.text}
        </pre>
      ) : (
        <span className="text-[13px] text-muted-foreground">{t('resource')}</span>
      );
  }
}
