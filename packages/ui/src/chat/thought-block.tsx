import type { ContentBlock } from '@linkcode/schema';
import { useTranslations } from 'use-intl';
import { ContentBlockView } from './content-block-view';
import { contentPreview } from './content-preview';
import { Reasoning, ReasoningContent, ReasoningTrigger } from './reasoning';

export function ThoughtBlock({
  blocks,
  isStreaming = false,
}: {
  blocks: ContentBlock[];
  isStreaming?: boolean;
}): React.ReactNode {
  const t = useTranslations('workbench.conversation');
  const preview = contentPreview(blocks);

  return (
    <Reasoning isStreaming={isStreaming}>
      <ReasoningTrigger label={t('thought')} preview={preview} />
      <ReasoningContent>
        {blocks.map((block, index) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- append-only stream: index+type is a stable position key across token-by-token re-renders
          <ContentBlockView key={`${index}:${block.type}`} block={block} />
        ))}
      </ReasoningContent>
    </Reasoning>
  );
}
