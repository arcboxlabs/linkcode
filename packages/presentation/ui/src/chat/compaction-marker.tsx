import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { Separator } from 'coss-ui/components/separator';
import { Spinner } from 'coss-ui/components/spinner';
import { FoldVerticalIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import {
  CHAT_DISCLOSURE_SUMMARY_CLASS_NAME,
  CHAT_DISCLOSURE_TEXT_CLASS_NAME,
  CHAT_DISCLOSURE_TITLE_CLASS_NAME,
  CHAT_DISCLOSURE_TRIGGER_CLASS_NAME,
  ChatDisclosureChevron,
  ChatDisclosureIconSlot,
} from './disclosure-header';
import { Markdown } from './markdown';
import { Shimmer } from './shimmer';
import { formatElapsed, useNowEverySecond } from './use-elapsed';

export interface CompactionMarkerProps {
  /** Live compaction still running: renders a shimmering "compacting…" row instead of the divider. */
  inProgress?: boolean;
  /** When the compaction started (the item's `receivedAt`); drives the live elapsed counter. */
  startedAt?: number;
  preTokens?: number;
  postTokens?: number;
  /** The summary the agent swapped in for the compacted turns; expandable when present. */
  summary?: string;
}

/** The live "compacting…" row: an animated spinner + shimmering label + elapsed counter, mirroring
 * codex's in-progress status. Kept a separate component so the per-second clock is subscribed only
 * while a compaction is actually running (this row is mounted only then). */
function CompactingRow({ startedAt }: { startedAt?: number }): React.ReactNode {
  const t = useTranslations('workbench.conversation');
  const now = useNowEverySecond();
  const elapsed = startedAt === undefined ? null : formatElapsed(now - startedAt);
  return (
    <div className="my-2 flex items-center gap-2 text-[13px] text-muted-foreground">
      <Spinner className="size-3.5 shrink-0" />
      <Shimmer className="font-medium">{t('compacting')}</Shimmer>
      {elapsed ? <span className="text-muted-foreground/70">· {elapsed}</span> : null}
    </div>
  );
}

/** Compact token counts ("193437" → "193.4k", "1193437" → "1.2M") so the marker reads at a glance. */
function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

/** Timeline divider for a context compaction: turns above stay visible while the agent continues
 * from the swapped-in summary; the row expands to show the summary when present. */
export function CompactionMarker({
  inProgress,
  startedAt,
  preTokens,
  postTokens,
  summary,
}: CompactionMarkerProps): React.ReactNode {
  const t = useTranslations('workbench.conversation');
  const [open, setOpen] = useState(false);

  if (inProgress) {
    return <CompactingRow startedAt={startedAt} />;
  }

  const detail =
    preTokens !== undefined && postTokens !== undefined
      ? t('compactedTokens', { pre: formatTokens(preTokens), post: formatTokens(postTokens) })
      : null;

  const row = (
    <>
      <ChatDisclosureIconSlot>
        <FoldVerticalIcon />
      </ChatDisclosureIconSlot>
      <span className={CHAT_DISCLOSURE_TEXT_CLASS_NAME}>
        <span className={CHAT_DISCLOSURE_TITLE_CLASS_NAME}>{t('compacted')}</span>
        {detail ? <span className={CHAT_DISCLOSURE_SUMMARY_CLASS_NAME}>{detail}</span> : null}
      </span>
    </>
  );

  if (!summary) {
    return (
      <div className="my-2 flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
        {row}
        <Separator className="min-w-8 flex-1" />
      </div>
    );
  }

  return (
    <Collapsible
      className="my-2 text-[13px] text-muted-foreground"
      onOpenChange={setOpen}
      open={open}
    >
      <div className="flex min-w-0 items-center gap-2">
        <CollapsibleTrigger className={cn(CHAT_DISCLOSURE_TRIGGER_CLASS_NAME, 'max-w-full shrink')}>
          {row}
          <ChatDisclosureChevron open={open} />
        </CollapsibleTrigger>
        <Separator className="min-w-8 flex-1" />
      </div>
      <CollapsibleContent className="mt-1 border-l-2 border-border pl-3">
        <Markdown>{summary}</Markdown>
      </CollapsibleContent>
    </Collapsible>
  );
}
