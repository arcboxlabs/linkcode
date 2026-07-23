import { Button } from 'coss-ui/components/button';
import { Collapsible, CollapsibleTrigger } from 'coss-ui/components/collapsible';
import { Frame } from 'coss-ui/components/frame';
import { FileDiffIcon, Undo2Icon } from 'lucide-react';
import { useRef } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { fileBasename } from './artifacts/file-kind';
import { useArtifactHostActions } from './artifacts/host-actions';
import { ChatCardActions, ChatCardHeader, ChatCardPanel } from './chat-card';
import { ChatDisclosureContent } from './disclosure-content';
import {
  CHAT_DISCLOSURE_TEXT_CLASS_NAME,
  CHAT_DISCLOSURE_TITLE_CLASS_NAME,
  CHAT_DISCLOSURE_TRIGGER_CLASS_NAME,
  ChatDisclosureChevron,
  ChatDisclosureIconSlot,
} from './disclosure-header';
import { FileIdentityIcon } from './file-identity-icon';
import type { TurnEdits, TurnFileEdit } from './turn-edits';
import { FilePathTooltip } from './with-tooltip';

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
    <Frame className="my-1 text-sm">
      <ChatCardHeader className="text-sm">
        <ChatDisclosureIconSlot>
          <FileDiffIcon />
        </ChatDisclosureIconSlot>
        <span className="min-w-0 truncate font-medium text-foreground">
          {t('title', { count: edits.files.length })}
        </span>
        <DiffStat additions={edits.additions} deletions={edits.deletions} />
        <ChatCardActions>
          <Button disabled={!onUndo} size="sm" type="button" variant="ghost" onClick={onUndo}>
            <Undo2Icon />
            {t('undo')}
          </Button>
          <Button disabled={!onReview} size="sm" type="button" variant="outline" onClick={onReview}>
            {t('review')}
          </Button>
        </ChatCardActions>
      </ChatCardHeader>
      {edits.files.length > 0 ? (
        <ChatCardPanel className="overflow-hidden px-0 py-1">
          <Collapsible>
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
                  className={cn(CHAT_DISCLOSURE_TRIGGER_CLASS_NAME, 'w-fit max-w-full px-3')}
                >
                  <span className={CHAT_DISCLOSURE_TEXT_CLASS_NAME}>
                    <span
                      className={cn(
                        CHAT_DISCLOSURE_TITLE_CLASS_NAME,
                        'group-data-[panel-open]:hidden',
                      )}
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
                  {/* Expands downward, collapses upward — not the tree-node right→down chevron. */}
                  <ChatDisclosureChevron className="rotate-90 group-data-[panel-open]:-rotate-90" />
                </CollapsibleTrigger>
              </>
            )}
          </Collapsible>
        </ChatCardPanel>
      ) : null}
    </Frame>
  );
}

/** Basename row with the file-identity icon; the full path lives in the hover tooltip. */
function FileRow({
  file,
  onOpenFile,
}: {
  file: TurnFileEdit;
  onOpenFile?: (path: string) => void;
}): React.ReactNode {
  const tooltipAnchorRef = useRef<HTMLSpanElement>(null);
  const rowClassName =
    'flex w-full items-center gap-2 px-3 py-1 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';
  const body = (
    <>
      <FileIdentityIcon className="shrink-0" path={file.path} ref={tooltipAnchorRef} />
      <span className="min-w-0 flex-1 truncate">{fileBasename(file.path)}</span>
      <DiffStat additions={file.additions} deletions={file.deletions} />
    </>
  );

  return (
    <FilePathTooltip anchor={tooltipAnchorRef} tooltip={file.path}>
      {onOpenFile ? (
        <button
          className={cn(rowClassName, 'cursor-pointer transition-colors hover:bg-muted')}
          type="button"
          onClick={() => onOpenFile(file.path)}
        >
          {body}
        </button>
      ) : (
        <div className={rowClassName} tabIndex={0}>
          {body}
        </div>
      )}
    </FilePathTooltip>
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
