import type { ContentBlock } from '@linkcode/schema';
import { useTranslations } from 'use-intl';
import { ContentBlockView } from './content-block-view';
import { keyedItems, stableContentKey } from './content-keys';
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
        {keyedItems(blocks, stableContentKey).map(({ key, item }) => (
          <ContentBlockView key={key} block={item} />
        ))}
      </ReasoningContent>
    </Reasoning>
  );
}
