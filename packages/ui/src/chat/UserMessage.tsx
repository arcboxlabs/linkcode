import type { ContentBlock } from '@linkcode/schema';
import type { ReactElement } from 'react';
import { ContentBlockView } from './ContentBlockView';

export function UserMessage({ blocks }: { blocks: ContentBlock[] }): ReactElement {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] break-words rounded-2xl bg-secondary px-4 py-2.5 text-[14px] leading-relaxed text-secondary-foreground">
        {blocks.map((block, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: content blocks have no stable id
          <ContentBlockView key={i} block={block} />
        ))}
      </div>
    </div>
  );
}
