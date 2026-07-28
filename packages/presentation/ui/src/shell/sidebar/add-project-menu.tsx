import type { WorkspaceRecord } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from 'coss-ui/components/dialog';
import { Field, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Input } from 'coss-ui/components/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'coss-ui/components/menu';
import { SidebarGroupAction } from 'coss-ui/components/sidebar';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { FolderOpenIcon, FolderPlusIcon, HistoryIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

export interface AddProjectMenuProps {
  /** Opens the new-session page with the default workspace — "Start from scratch". */
  onStartDraft: () => void;
  /** Opens the native directory picker; desktop only — omit to fall back to the path dialog. */
  onPickDirectory?: () => Promise<string | null>;
  onRegisterWorkspace: (cwd: string) => Promise<WorkspaceRecord>;
  /** Opens the provider history import surface; desktop only — the item hides without it. */
  onImportHistory?: () => void;
}

/** The Projects header "+" menu. "Use an existing folder" prefers the native picker; the path
 * dialog is the webview fallback and the error surface for a failed registration. */
export function AddProjectMenu({
  onStartDraft,
  onPickDirectory,
  onRegisterWorkspace,
  onImportHistory,
}: AddProjectMenuProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [path, setPath] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function openDialog(prefillPath = '', err: unknown = null): void {
    setPath(prefillPath);
    setError(err);
    setPending(false);
    setDialogOpen(true);
  }

  function closeDialog(): void {
    setDialogOpen(false);
    setPath('');
    setPending(false);
    setError(null);
  }

  async function register(cwd: string): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      await onRegisterWorkspace(cwd);
      return true;
    } catch (err) {
      setError(err);
      setPending(false);
      return false;
    }
  }

  async function handleUseExistingFolder(): Promise<void> {
    if (!onPickDirectory) {
      openDialog();
      return;
    }
    let picked: string | null;
    try {
      picked = await onPickDirectory();
    } catch (err) {
      openDialog('', err);
      return;
    }
    if (!picked) return;
    try {
      await onRegisterWorkspace(picked);
    } catch (err) {
      // The dialog doubles as the error surface: prefilled with the pick that failed.
      openDialog(picked, err);
    }
  }

  async function handleBrowseInDialog(): Promise<void> {
    if (!onPickDirectory) return;
    let picked: string | null;
    try {
      picked = await onPickDirectory();
    } catch (err) {
      setError(err);
      return;
    }
    if (!picked) return;
    setPath(picked);
    if (await register(picked)) closeDialog();
  }

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    const trimmed = path.trim();
    if (!trimmed) return;
    void register(trimmed).then((registered) => {
      if (registered) closeDialog();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarGroupAction
              aria-label={t('addProject')}
              title={t('addProject')}
              className="hover:bg-transparent"
            />
          }
        >
          <PlusIcon className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" sideOffset={8} className="w-56">
          <DropdownMenuItem onClick={onStartDraft}>
            <PlusIcon />
            {t('startFromScratch')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void handleUseExistingFolder();
            }}
          >
            <FolderOpenIcon />
            {t('useExistingFolder')}
          </DropdownMenuItem>
          {onImportHistory && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onImportHistory}>
                <HistoryIcon />
                {t('importHistory')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={dialogOpen}
        disablePointerDismissal={pending}
        onOpenChange={(open) => {
          if (!open && !pending) closeDialog();
        }}
      >
        <DialogPopup className="max-w-md" closeProps={{ disabled: pending }}>
          <DialogHeader>
            <DialogTitle>{t('useExistingFolder')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <DialogPanel className="space-y-3">
              {onPickDirectory && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  disabled={pending}
                  onClick={() => {
                    void handleBrowseInDialog();
                  }}
                >
                  <FolderPlusIcon />
                  {t('chooseDirectory')}
                </Button>
              )}
              <Field name="path" invalid={error != null}>
                <FieldLabel className="sr-only">{t('useExistingFolder')}</FieldLabel>
                <Input
                  autoFocus={!onPickDirectory}
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  placeholder={t('addWorkspacePathPlaceholder')}
                  disabled={pending}
                  size="sm"
                />
                <FieldError match={error != null}>
                  {error != null &&
                    t('registerWorkspaceError', {
                      message: extractErrorMessage(error, false) ?? '',
                    })}
                </FieldError>
              </Field>
            </DialogPanel>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={closeDialog}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={pending || path.trim().length === 0}>
                {t('addWorkspaceSubmit')}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </>
  );
}
