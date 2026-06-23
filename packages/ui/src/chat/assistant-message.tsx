import type { ContentBlock } from '@linkcode/schema';
import type { ReactNode } from 'react';
import { ContentBlockView } from './content-block-view';
import { keyedItems, stableContentKey } from './content-keys';

export function AssistantMessage({ blocks }: { blocks: ContentBlock[] }): ReactNode {
  return (
    <div className="space-y-1 text-foreground">
      {keyedItems(blocks, stableContentKey).map(({ key, item }) => (
        <ContentBlockView key={key} block={item} />
      ))}
    </div>
  );
}
