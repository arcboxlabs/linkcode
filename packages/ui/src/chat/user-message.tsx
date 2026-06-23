import type { ContentBlock } from '@linkcode/schema';
import type { ReactNode } from 'react';
import { ContentBlockView } from './content-block-view';
import { keyedItems, stableContentKey } from './content-keys';

export function UserMessage({ blocks }: { blocks: ContentBlock[] }): ReactNode {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] break-words rounded-2xl bg-secondary px-4 py-2.5 text-[14px] leading-relaxed text-secondary-foreground">
        {keyedItems(blocks, stableContentKey).map(({ key, item }) => (
          <ContentBlockView key={key} block={item} />
        ))}
      </div>
    </div>
  );
}
