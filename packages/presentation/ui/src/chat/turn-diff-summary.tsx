import { Button } from 'coss-ui/components/button';
import { Card } from 'coss-ui/components/card';
import { Collapsible, CollapsibleTrigger } from 'coss-ui/components/collapsible';
import { FileDiffIcon, Undo2Icon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { useArtifactHostActions } from './artifacts/host-actions';
import { ChatDisclosureContent } from './disclosure-content';
import {
  CHAT_DISCLOSURE_TEXT_CLASS_NAME,
  CHAT_DISCLOSURE_TITLE_CLASS_NAME,
  CHAT_DISCLOSURE_TRIGGER_CLASS_NAME,
  ChatDisclosureChevron,
  ChatDisclosureIconSlot,
} from './disclosure-header';
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
  /** Opens the host's review surface; disabled when the current shell has none. */
  onReview?: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.diffSummary');
  const openFile = useArtifactHostActions()?.openFile;
  const visibleFiles = edits.files.slice(0, COLLAPSED_FILE_COUNT);
  const overflowFiles = edits.files.slice(COLLAPSED_FILE_COUNT);

  return (
    <Card className="my-1 bg-card text-sm">
      <div className="flex items-center px-3 py-2 gap-1">
        <div className="min-w-0 flex flex-1 gap-2 items-center">
          <ChatDisclosureIconSlot className="text-muted-foreground">
            <FileDiffIcon />
          </ChatDisclosureIconSlot>
          <div className="min-w-0 shrink truncate font-medium">
            {t('title', { count: edits.files.length })}
          </div>
          <DiffStat additions={edits.additions} deletions={edits.deletions} />
        </div>
        <Button disabled={!onUndo} size="sm" type="button" variant="ghost" onClick={onUndo}>
          <Undo2Icon />
          {t('undo')}
        </Button>
        <Button disabled={!onReview} size="sm" type="button" variant="outline" onClick={onReview}>
          {t('review')}
        </Button>
      </div>
      <Collapsible className="border-border border-t px-3 py-1">
        {visibleFiles.map((file) => (
          <FileRow key={file.path} file={file} onOpenFile={openFile} />
        ))}
        {overflowFiles.length > 0 && (
          <>
            <ChatDisclosureContent>
              {overflowFiles.map((file) => (
                <FileRow key={file.path} file={file} onOpenFile={openFile} />
              ))}
            </ChatDisclosureContent>
            <CollapsibleTrigger
              className={cn(CHAT_DISCLOSURE_TRIGGER_CLASS_NAME, 'w-fit max-w-full')}
            >
              <span className={CHAT_DISCLOSURE_TEXT_CLASS_NAME}>
                <span
                  className={cn(CHAT_DISCLOSURE_TITLE_CLASS_NAME, 'group-data-[panel-open]:hidden')}
                >
                  {t('showMore', { count: overflowFiles.length })}
                </span>
                <span
                  className={cn(
                    CHAT_DISCLOSURE_TITLE_CLASS_NAME,
                    'hidden group-data-[panel-open]:inline',
                  )}
                >
                  {t('showLess')}
                </span>
              </span>
              <ChatDisclosureChevron />
            </CollapsibleTrigger>
          </>
        )}
      </Collapsible>
    </Card>
  );
}

function FileRow({
  file,
  onOpenFile,
}: {
  file: TurnFileEdit;
  onOpenFile?: (path: string) => void;
}): React.ReactNode {
  const basenameStart = file.path.lastIndexOf('/') + 1;
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate text-ellipsis text-sm">
        <span className="text-muted-foreground transition-colors group-hover/file:text-foreground">
          {file.path.slice(0, basenameStart)}
        </span>
        <span className="text-foreground">{file.path.slice(basenameStart)}</span>
      </span>
      <DiffStat additions={file.additions} deletions={file.deletions} />
    </>
  );

  if (!onOpenFile) return <div className="flex items-center gap-2 py-1">{body}</div>;

  return (
    <Button
      className="group/file h-auto w-full justify-start rounded-none border-0 px-0 py-1 text-left font-normal text-sm hover:bg-transparent sm:text-sm"
      variant="ghost"
      onClick={() => onOpenFile(file.path)}
    >
      {body}
    </Button>
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
