import type { ContentBlock } from '@linkcode/schema';
import { ChevronRightIcon, CircleDashedIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { ContentBlockView } from './content-block-view';
import { contentPreview } from './content-preview';

export function ThoughtBlock({ blocks }: { blocks: ContentBlock[] }): ReactElement {
  const t = useTranslations('workbench.conversation');
  const [open, setOpen] = useState(false);
  const preview = contentPreview(blocks);

  return (
    <div className="text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 py-0.5 text-left text-[13px] hover:text-foreground"
      >
        <CircleDashedIcon className="size-3.5 shrink-0" />
        <span className="font-medium">{t('thought')}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground/70">
          {open ? '' : preview}
        </span>
        <ChevronRightIcon
          className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
        />
      </button>
      {open && (
        <div className="mt-1 border-l-2 border-border pl-3 text-[13px] italic opacity-90">
          {blocks.map((block, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: content blocks have no stable id
            <ContentBlockView key={i} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}
