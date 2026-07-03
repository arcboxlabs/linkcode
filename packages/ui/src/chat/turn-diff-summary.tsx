import { Button } from 'coss-ui/components/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from 'coss-ui/components/collapsible';
import { ChevronDownIcon, FileDiffIcon, Undo2Icon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import type { TurnEdits, TurnFileEdit } from './turn-edits';

const COLLAPSED_FILE_COUNT = 3;

/** End-of-turn rollup of the files the agent edited, with undo/review actions. */
export function TurnDiffSummary({
  edits,
  onUndo,
  onReview,
}: {
  edits: TurnEdits;
  /** TODO(git): wire to checkpoint restore once the git integration lands; disabled until then. */
  onUndo?: () => void;
  /** TODO(review): open the diff review once conversation↔panel navigation is designed. */
  onReview?: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.diffSummary');
  const visibleFiles = edits.files.slice(0, COLLAPSED_FILE_COUNT);
  const overflowFiles = edits.files.slice(COLLAPSED_FILE_COUNT);

  return (
    <div className="my-1 rounded-xl border border-border bg-card text-sm">
      <div className="flex items-center px-3 py-2 gap-1">
        <div className="min-w-0 flex flex-1 gap-2 items-center">
          <FileDiffIcon className="size-3.5 text-muted-foreground" />
          <div className="font-medium">{t('title', { count: edits.files.length })}</div>
          <DiffStat additions={edits.additions} deletions={edits.deletions} />
        </div>
        <Button disabled={!onUndo} type="button" variant="ghost" onClick={onUndo}>
          <Undo2Icon />
          {t('undo')}
        </Button>
        <Button disabled={!onReview} type="button" variant="outline" onClick={onReview}>
          {t('review')}
        </Button>
      </div>
      <Collapsible className="border-border border-t px-3 py-1">
        {visibleFiles.map((file) => (
          <FileRow key={file.path} file={file} />
        ))}
        {overflowFiles.length > 0 && (
          <>
            <CollapsibleContent>
              {overflowFiles.map((file) => (
                <FileRow key={file.path} file={file} />
              ))}
            </CollapsibleContent>
            <CollapsibleTrigger className="group flex items-center gap-1 py-1 text-muted-foreground text-sm hover:text-foreground">
              <span className="group-data-[panel-open]:hidden">
                {t('showMore', { count: overflowFiles.length })}
              </span>
              <span className="hidden group-data-[panel-open]:inline">{t('showLess')}</span>
              <ChevronDownIcon className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
            </CollapsibleTrigger>
          </>
        )}
      </Collapsible>
    </div>
  );
}

function FileRow({ file }: { file: TurnFileEdit }): React.ReactNode {
  const basenameStart = file.path.lastIndexOf('/') + 1;

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="min-w-0 flex-1 truncate font-mono text-sm text-ellipsis">
        <span className="text-muted-foreground">{file.path.slice(0, basenameStart)}</span>
        <span className="text-foreground">{file.path.slice(basenameStart)}</span>
      </span>
      <DiffStat additions={file.additions} deletions={file.deletions} />
    </div>
  );
}

function DiffStat({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}): React.ReactNode {
  return (
    <div className="flex shrink-0 items-center gap-1 font-mono text-sm">
      <span className="text-success-foreground">+{additions}</span>
      <span className="text-destructive-foreground">-{deletions}</span>
    </div>
  );
}
