import type { WorkspaceRecord } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { Input } from 'coss-ui/components/input';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from 'coss-ui/components/sidebar';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { FolderPlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

export interface AddWorkspaceRowProps {
  /** Opens the native directory picker; desktop only — omit to keep the manual path field only. */
  onPickDirectory?: () => Promise<string | null>;
  onRegisterWorkspace: (cwd: string) => Promise<WorkspaceRecord>;
}

/** The sidebar's tail row: an inline expanding form that registers a directory as a workspace. */
export function AddWorkspaceRow({
  onPickDirectory,
  onRegisterWorkspace,
}: AddWorkspaceRowProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function reset(): void {
    setOpen(false);
    setPath('');
    setPending(false);
    setError(null);
  }

  async function register(cwd: string): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await onRegisterWorkspace(cwd);
      reset();
    } catch (err) {
      setError(err);
      setPending(false);
    }
  }

  async function handleBrowse(): Promise<void> {
    if (!onPickDirectory) return;
    let picked: string | null;
    try {
      picked = await onPickDirectory();
    } catch (err) {
      setError(err);
      return;
    }
    if (picked) await register(picked);
  }

  function handleSubmit(event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>): void {
    event.preventDefault();
    const trimmed = path.trim();
    if (!trimmed) return;
    void register(trimmed);
  }

  if (!open) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton onClick={() => setOpen(true)}>
            <FolderPlusIcon className="text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{t('addWorkspace')}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5 px-2 py-1">
      {onPickDirectory && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={pending}
          onClick={() => {
            void handleBrowse();
          }}
        >
          <FolderPlusIcon />
          {t('chooseDirectory')}
        </Button>
      )}
      <Input
        autoFocus={!onPickDirectory}
        value={path}
        onChange={(event) => setPath(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            reset();
          }
        }}
        placeholder={t('addWorkspacePathPlaceholder')}
        disabled={pending}
        size="sm"
      />
      <div className="flex items-center gap-1.5">
        <Button
          type="submit"
          size="sm"
          className="flex-1"
          disabled={pending || path.trim().length === 0}
        >
          {t('addWorkspaceSubmit')}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={reset}>
          {t('cancel')}
        </Button>
      </div>
      {error != null && (
        <div className="text-destructive text-xs">
          {t('registerWorkspaceError', { message: extractErrorMessage(error, false) ?? '' })}
        </div>
      )}
    </form>
  );
}
