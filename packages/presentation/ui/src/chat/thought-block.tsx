import type { ContentBlock } from '@linkcode/schema';
import { useTranslations } from 'use-intl';
import { ContentBlockView } from './content-block-view';
import { positionalBlockEntries } from './content-derived-keys';
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
        {positionalBlockEntries(blocks).map(({ block, key }) => (
          <ContentBlockView key={key} block={block} />
        ))}
      </ReasoningContent>
    </Reasoning>
  );
}
