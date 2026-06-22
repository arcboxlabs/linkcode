import type { ContentBlock } from '@linkcode/schema';
import type { ReactElement } from 'react';
import { ContentBlockView } from './content-block-view';

export function AssistantMessage({ blocks }: { blocks: ContentBlock[] }): ReactElement {
  return (
    <div className="space-y-1 text-foreground">
      {blocks.map((block, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: content blocks have no stable id
        <ContentBlockView key={i} block={block} />
      ))}
    </div>
  );
}
