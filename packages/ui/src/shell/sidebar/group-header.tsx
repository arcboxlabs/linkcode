import type { WorkspaceRecord } from '@linkcode/schema';
import { AccordionPrimitive } from 'coss-ui/components/accordion';
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
import { Input } from 'coss-ui/components/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'coss-ui/components/menu';
import { PreviewCard, PreviewCardTrigger } from 'coss-ui/components/preview-card';
import { SidebarMenuButton } from 'coss-ui/components/sidebar';
import { extractErrorMessage } from 'foxts/extract-error-message';
import {
  ArchiveIcon,
  EllipsisIcon,
  FolderIcon,
  FolderOpenIcon,
  MessagesSquareIcon,
  PencilIcon,
  PlusIcon,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../../lib/cn';
import type { BranchStatusComponentType } from './branch-status';
import { SidebarPreviewCardPopup } from './preview-card';
import { ROW_ACTION_CLASS, ROW_HOVER_PE_CLASS, RowActionsCluster } from './row-actions';

export interface ThreadGroupHeaderProps {
  title: string;
  workspace: WorkspaceRecord | null;
  /** The group's full session count, shown in the header's preview card. */
  threadCount: number;
  /** Mirrors the surrounding accordion item's open state (the trigger owns toggling). */
  collapsed: boolean;
  /** Opens the new-session page preselecting this group's workspace. Undefined for the
   * unregistered fallback group — it has no single `cwd` to start a thread in. */
  onNewThread?: () => void;
  onRename?: (name: string) => Promise<void>;
  onArchive?: () => Promise<void>;
  BranchStatusComponent?: BranchStatusComponentType;
  /** Marks the header as its group's drag handle — the whole section moves by grabbing this row. */
  dragHandleRef?: (element: Element | null) => void;
}

const FOLDER_ICON_SPRING = { type: 'spring', duration: 0.3, bounce: 0 } as const;
const FOLDER_ICON_SHOWN = { opacity: 1, scale: 1, filter: 'blur(0px)' };
const FOLDER_ICON_HIDDEN = { opacity: 0, scale: 0.25, filter: 'blur(4px)' };

/** Closed/open folder pair cross-fading with the group's collapse state. */
function FolderToggleIcon({ open }: { open: boolean }): React.ReactNode {
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion ? { duration: 0 } : FOLDER_ICON_SPRING;
  return (
    <span aria-hidden className="relative size-4 shrink-0">
      <motion.span
        className="absolute inset-0"
        initial={false}
        animate={open ? FOLDER_ICON_HIDDEN : FOLDER_ICON_SHOWN}
        transition={transition}
      >
        <FolderIcon className="size-4" />
      </motion.span>
      <motion.span
        className="absolute inset-0"
        initial={false}
        animate={open ? FOLDER_ICON_SHOWN : FOLDER_ICON_HIDDEN}
        transition={transition}
      >
        <FolderOpenIcon className="size-4" />
      </motion.span>
    </span>
  );
}

/** A group's header row: title + branch badge, collapse toggle, and hover-revealed actions. */
export function ThreadGroupHeader({
  title,
  workspace,
  threadCount,
  collapsed,
  onNewThread,
  onRename,
  onArchive,
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
  const hasActions = Boolean(onNewThread || onRename || onArchive);

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
    <AccordionPrimitive.Header
      render={<div ref={dragHandleRef} className="group/menu-item relative flex" />}
    >
      {renaming ? (
        <div className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-sidebar-foreground text-sm transition-[background-color,box-shadow] focus-within:bg-sidebar-accent focus-within:ring-1 focus-within:ring-inset focus-within:ring-sidebar-ring">
          <FolderToggleIcon open={!collapsed} />
          <Input
            unstyled
            size="sm"
            // biome-ignore lint/a11y/noAutofocus: opening the rename field is itself the user's action.
            autoFocus
            aria-label={t('renameWorkspace')}
            value={draftName}
            className="min-w-0 flex-1 [&>[data-slot=input]]:px-0"
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
          />
        </div>
      ) : (
        <PreviewCard>
          <AccordionPrimitive.Trigger
            render={
              <PreviewCardTrigger
                render={
                  <SidebarMenuButton
                    aria-label={collapsed ? t('expandGroup') : t('collapseGroup')}
                    className={cn(
                      'hover:bg-transparent focus-visible:ring-1 focus-visible:ring-inset',
                      hasActions && ROW_HOVER_PE_CLASS,
                    )}
                  />
                }
              >
                <FolderToggleIcon open={!collapsed} />
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="max-w-full shrink-0 truncate">{title}</span>
                  {workspace && BranchStatusComponent && (
                    <BranchStatusComponent cwd={workspace.cwd} />
                  )}
                </span>
              </PreviewCardTrigger>
            }
          />
          {workspace && (
            <SidebarPreviewCardPopup>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <span>{title}</span>
                <div className="flex flex-col gap-1.5 text-muted-foreground text-xs">
                  <span className="flex items-center gap-1.5">
                    <MessagesSquareIcon className="size-3.5 shrink-0" />
                    <span>{t('threadCount', { count: threadCount })}</span>
                  </span>
                  <span className="flex gap-1.5">
                    <FolderIcon className="mt-px size-3.5 shrink-0" />
                    <span className="break-all">{workspace.cwd}</span>
                  </span>
                </div>
              </div>
            </SidebarPreviewCardPopup>
          )}
        </PreviewCard>
      )}
      {renameError != null && (
        <div className="-bottom-5 absolute left-0 z-10 px-1 text-destructive text-xs">
          {t('renameWorkspaceError', { message: extractErrorMessage(renameError, false) ?? '' })}
        </div>
      )}
      {!renaming && hasActions && (
        <RowActionsCluster>
          {onNewThread && (
            <Button
              aria-label={t('newThread')}
              title={t('newThread')}
              className={ROW_ACTION_CLASS}
              size="icon-xs"
              variant="ghost"
              onClick={onNewThread}
            >
              <PlusIcon />
            </Button>
          )}
          {(onRename || onArchive) && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={t('groupActions')}
                title={t('groupActions')}
                render={<Button className={ROW_ACTION_CLASS} size="icon-xs" variant="ghost" />}
              >
                <EllipsisIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="right"
                sideOffset={8}
                className="w-52"
                finalFocus={(closeType) => closeType === 'keyboard'}
              >
                {onRename && (
                  <DropdownMenuItem onClick={beginRename}>
                    <PencilIcon />
                    {t('renameWorkspace')}
                  </DropdownMenuItem>
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
        </RowActionsCluster>
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
    </AccordionPrimitive.Header>
  );
}
