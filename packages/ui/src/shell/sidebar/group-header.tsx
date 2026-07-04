import type { WorkspaceRecord } from '@linkcode/schema';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from 'coss-ui/components/alert-dialog';
import { Button } from 'coss-ui/components/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'coss-ui/components/menu';
import { extractErrorMessage } from 'foxts/extract-error-message';
import {
  ArchiveIcon,
  ChevronRightIcon,
  EllipsisIcon,
  HistoryIcon,
  PencilIcon,
  PlusIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import type { BranchStatusComponentType } from './branch-status';

export interface ThreadGroupHeaderProps {
  title: string;
  workspace: WorkspaceRecord | null;
  sessionCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Opens the new-session page preselecting this group's workspace. Undefined for the
   * unregistered fallback group — it has no single `cwd` to start a thread in. */
  onNewThread?: () => void;
  onRename?: (name: string) => Promise<void>;
  onArchive?: () => Promise<void>;
  historyOpen: boolean;
  onToggleHistory?: () => void;
  BranchStatusComponent?: BranchStatusComponentType;
  /** Marks the header as its group's drag handle — the whole section moves by grabbing this row. */
  dragHandleRef?: (element: Element | null) => void;
}

/** A group's header row: title + branch badge, collapse toggle, and hover-revealed actions. */
export function ThreadGroupHeader({
  title,
  workspace,
  sessionCount,
  collapsed,
  onToggleCollapsed,
  onNewThread,
  onRename,
  onArchive,
  historyOpen,
  onToggleHistory,
  BranchStatusComponent,
  dragHandleRef,
}: ThreadGroupHeaderProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(title);
  const [renameError, setRenameError] = useState<unknown>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveError, setArchiveError] = useState<unknown>(null);
  const [archivePending, setArchivePending] = useState(false);
  const hasActions = Boolean(onNewThread || onRename || onArchive || onToggleHistory);

  function beginRename(): void {
    setDraftName(title);
    setRenameError(null);
    setRenaming(true);
  }

  function commitRename(): void {
    const trimmed = draftName.trim();
    if (!onRename || !trimmed || trimmed === title) {
      setRenaming(false);
      return;
    }
    void onRename(trimmed)
      .then(() => setRenaming(false))
      .catch((err: unknown) => setRenameError(err));
  }

  function cancelRename(): void {
    setRenaming(false);
    setRenameError(null);
  }

  function confirmArchive(): void {
    if (!onArchive) return;
    setArchivePending(true);
    setArchiveError(null);
    void onArchive()
      .then(() => setArchiveOpen(false))
      .catch((err: unknown) => setArchiveError(err))
      .finally(() => setArchivePending(false));
  }

  return (
    <div
      ref={dragHandleRef}
      className="group relative flex h-7 items-center gap-1.5 rounded-md px-[var(--lc-sidebar-edge,0.5rem)]"
    >
      {renaming ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: opening the rename field is itself the user's action.
          autoFocus
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitRename();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancelRename();
            }
          }}
          onBlur={commitRename}
          className="min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={workspace?.cwd}
          aria-label={collapsed ? t('expandGroup') : t('collapseGroup')}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 rounded-sm py-1 text-left text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            hasActions && 'pr-14',
          )}
        >
          <ChevronRightIcon
            aria-hidden
            className={cn('size-3 shrink-0 transition-transform', !collapsed && 'rotate-90')}
          />
          <span className="min-w-0 truncate font-medium">{title}</span>
          {workspace && BranchStatusComponent && <BranchStatusComponent cwd={workspace.cwd} />}
          <span className="ml-auto shrink-0 tabular-nums">{sessionCount}</span>
        </button>
      )}
      {renameError != null && (
        <div className="-bottom-5 absolute left-0 z-10 px-1 text-destructive text-xs">
          {t('renameWorkspaceError', { message: extractErrorMessage(renameError, false) ?? '' })}
        </div>
      )}
      {!renaming && hasActions && (
        <div className="-translate-y-1/2 absolute top-1/2 right-1 flex items-center gap-0.5 opacity-0 outline-none focus-within:opacity-100 group-hover:opacity-100">
          {onNewThread && (
            <button
              type="button"
              aria-label={t('newThread')}
              title={t('newThread')}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onNewThread}
            >
              <PlusIcon className="size-3.5" />
            </button>
          )}
          {(onRename || onArchive || onToggleHistory) && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t('groupActions')}
                title={t('groupActions')}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <EllipsisIcon className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right" sideOffset={8} className="w-52">
                {onRename && (
                  <DropdownMenuItem onClick={beginRename}>
                    <PencilIcon />
                    {t('renameWorkspace')}
                  </DropdownMenuItem>
                )}
                {onToggleHistory && (
                  <DropdownMenuCheckboxItem checked={historyOpen} onCheckedChange={onToggleHistory}>
                    <HistoryIcon />
                    {t('importHistoryTitle')}
                  </DropdownMenuCheckboxItem>
                )}
                {onArchive && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setArchiveOpen(true)}>
                      <ArchiveIcon />
                      {t('archiveWorkspace')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
      {onArchive && (
        <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
          <AlertDialogPopup>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('archiveWorkspaceTitle', { name: title })}</AlertDialogTitle>
              <AlertDialogDescription>{t('archiveWorkspaceDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            {archiveError != null && (
              <div className="px-6 pb-4 text-destructive text-xs">
                {t('archiveWorkspaceError', {
                  message: extractErrorMessage(archiveError, false) ?? '',
                })}
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline">{t('cancel')}</Button>} />
              <Button variant="destructive" disabled={archivePending} onClick={confirmArchive}>
                {t('archiveWorkspaceConfirm')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogPopup>
        </AlertDialog>
      )}
    </div>
  );
}
