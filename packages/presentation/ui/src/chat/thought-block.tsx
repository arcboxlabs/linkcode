import type { ContentBlock } from '@linkcode/schema';
import { useTranslations } from 'use-intl';
import { ContentBlockView } from './content-block-view';
import { positionalBlockEntries } from './content-derived-keys';
import { Reasoning, ReasoningContent, ReasoningTrigger } from './reasoning';
import { publicReasoningSummary } from './reasoning-summary';

export function ThoughtBlock({
  blocks,
  isStreaming = false,
  startedAt,
  endedAt,
  summary,
  constrainHeight = true,
}: {
  blocks: ContentBlock[];
  isStreaming?: boolean;
  startedAt?: number;
  endedAt?: number;
  summary?: string;
  constrainHeight?: boolean;
}): React.ReactNode {
  const t = useTranslations('workbench.conversation');
  const elapsedSeconds = thoughtElapsedSeconds(startedAt, endedAt);
  const label = isStreaming
    ? t('thinking')
    : elapsedSeconds === undefined
      ? t('thought')
      : t('thoughtDuration', { seconds: elapsedSeconds });

  return (
    <Reasoning isStreaming={isStreaming}>
      <ReasoningTrigger
        label={label}
        summary={isStreaming ? publicReasoningSummary(summary) : undefined}
      />
      <ReasoningContent constrainHeight={constrainHeight}>
        {positionalBlockEntries(blocks).map(({ block, key }) => (
          <ContentBlockView key={key} block={block} />
        ))}
      </ReasoningContent>
    </Reasoning>
  );
}

function thoughtElapsedSeconds(startedAt: number | undefined, endedAt: number | undefined) {
  if (
    startedAt === undefined ||
    endedAt === undefined ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endedAt) ||
    endedAt <= startedAt
  ) {
    return;
  }
  return Math.max(1, Math.floor((endedAt - startedAt) / 1000));
}
