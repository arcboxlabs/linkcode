import type { AgentKind, SessionId, WorkspaceId, WorkspaceRecord } from '@linkcode/schema';
import { Avatar, AvatarFallback } from 'coss-ui/components/avatar';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Popover, PopoverPopup, PopoverTrigger } from 'coss-ui/components/popover';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { Separator } from 'coss-ui/components/separator';
import { extractErrorMessage } from 'foxts/extract-error-message';
import {
  BotIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  FilePlus2Icon,
  FolderPlusIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { repositoryLabel } from './repository-label';
import { ShellSidebar, shellSidebarItemClassName } from './shell-sidebar';
import type { BranchStatusComponentType } from './sidebar';
import { AgentKindList } from './sidebar';
import type { ThreadGroupViewModel } from './threads-view';
import { ThreadsView } from './threads-view';

export { repositoryLabel } from './repository-label';
export type { ThreadGroupViewModel } from './threads-view';

export interface SessionSidebarProps {
  threadGroups: ThreadGroupViewModel[];
  workspaces: WorkspaceRecord[];
  workspacesLoading?: boolean;
  activeId: SessionId | null;
  topInsetClassName?: string;
  footer?: React.ReactNode;
  className?: string;
  onSelect: (id: SessionId) => void;
  onStop: (id: SessionId) => void;
  onCreate: (opts: { kind: AgentKind; cwd: string }) => void;
  /** Called once a history entry finishes importing as a new thread. */
  onImportSession?: (sessionId: SessionId) => void;
  /** Opens the native directory picker; desktop only — omit to hide "Choose directory…". */
  onPickDirectory?: () => Promise<string | null>;
  /** Registers a directory as a workspace — the top "New Task" menu and the Add workspace row. */
  onRegisterWorkspace: (cwd: string) => Promise<WorkspaceRecord>;
  onRenameWorkspace: (workspaceId: WorkspaceId, name: string) => Promise<void>;
  onArchiveWorkspace: (workspaceId: WorkspaceId) => Promise<void>;
  onToggleGroupCollapsed: (collapseKey: string) => void;
  onTogglePreviewExpanded: (groupKey: string) => void;
  onToggleImportHistory: (groupKey: string) => void;
  BranchStatusComponent?: BranchStatusComponentType;
  HistoryComponent?: React.ComponentType<{
    cwd: string;
    onImported: (sessionId: SessionId) => void;
  }>;
}

const ORGS = [{ label: 'ArcBox Labs', value: 'arcbox' }];

export function SessionSidebar({
  threadGroups,
  workspaces,
  workspacesLoading,
  activeId,
  topInsetClassName,
  footer,
  className,
  onSelect,
  onStop,
  onCreate,
  onImportSession,
  onPickDirectory,
  onRegisterWorkspace,
  onRenameWorkspace,
  onArchiveWorkspace,
  onToggleGroupCollapsed,
  onTogglePreviewExpanded,
  onToggleImportHistory,
  BranchStatusComponent,
  HistoryComponent,
}: SessionSidebarProps): React.ReactNode {
  return (
    <ShellSidebar
      className={className}
      topInset={
        topInsetClassName ? <div aria-hidden className={cn('shrink-0', topInsetClassName)} /> : null
      }
      footer={footer}
    >
      <div className="px-[var(--lc-sidebar-edge,0.5rem)] pb-1">
        <NewTaskMenu
          workspaces={workspaces}
          onCreate={onCreate}
          onPickDirectory={onPickDirectory}
          onRegisterWorkspace={onRegisterWorkspace}
        />
        <SidebarMenuButton disabled icon={<SearchIcon />} label="Search" />
        <SidebarMenuButton disabled icon={<SparklesIcon />} label="Automation" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-[var(--lc-sidebar-edge,0.5rem)] pt-[var(--lc-sidebar-edge,0.5rem)] pb-[var(--lc-sidebar-edge,0.5rem)]">
          <ThreadsView
            groups={threadGroups}
            workspacesLoading={workspacesLoading}
            activeId={activeId}
            onSelect={onSelect}
            onStop={onStop}
            onCreate={onCreate}
            onImportSession={onImportSession}
            onPickDirectory={onPickDirectory}
            onRegisterWorkspace={onRegisterWorkspace}
            onRenameWorkspace={onRenameWorkspace}
            onArchiveWorkspace={onArchiveWorkspace}
            onToggleGroupCollapsed={onToggleGroupCollapsed}
            onTogglePreviewExpanded={onTogglePreviewExpanded}
            onToggleImportHistory={onToggleImportHistory}
            BranchStatusComponent={BranchStatusComponent}
            HistoryComponent={HistoryComponent}
          />
        </div>
      </div>
    </ShellSidebar>
  );
}

function NewTaskMenu({
  workspaces,
  onCreate,
  onPickDirectory,
  onRegisterWorkspace,
}: {
  workspaces: WorkspaceRecord[];
  onCreate: (opts: { kind: AgentKind; cwd: string }) => void;
  onPickDirectory?: () => Promise<string | null>;
  onRegisterWorkspace: (cwd: string) => Promise<WorkspaceRecord>;
}): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AgentKind | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const canChooseDirectory = onPickDirectory != null;

  function reset(): void {
    setKind(null);
    setPending(false);
    setError(null);
  }

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (!next) reset();
  }

  function chooseWorkspace(cwd: string): void {
    if (!kind) return;
    setOpen(false);
    onCreate({ kind, cwd });
    reset();
  }

  async function handleChooseDirectory(): Promise<void> {
    if (!onPickDirectory) return;
    setPending(true);
    setError(null);
    try {
      const picked = await onPickDirectory();
      if (!picked) return;
      const workspace = await onRegisterWorkspace(picked);
      chooseWorkspace(workspace.cwd);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger className={shellSidebarItemClassName}>
        <SidebarMenuButtonContent icon={<FilePlus2Icon />} label="New Task" />
      </PopoverTrigger>
      <PopoverPopup align="start" side="right" sideOffset={8} className="w-64 p-0">
        {kind === null ? (
          <div className="p-1">
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">New task</div>
            <AgentKindList onPick={setKind} hint="Choose a working folder" />
          </div>
        ) : (
          <div className="p-1">
            <button
              type="button"
              onClick={reset}
              className="flex items-center gap-1 px-2 py-1.5 text-muted-foreground text-xs outline-none hover:text-foreground"
            >
              <ChevronLeftIcon className="size-3.5" />
              {t('chooseWorkspaceTitle')}
            </button>
            {workspaces.length === 0 && !canChooseDirectory && (
              <div className="px-2 py-3 text-center text-muted-foreground text-xs">
                {t('workspaceEmptyTitle')}
              </div>
            )}
            {workspaces.map((workspace) => (
              <button
                key={workspace.workspaceId}
                type="button"
                className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => chooseWorkspace(workspace.cwd)}
              >
                <span className="line-clamp-1 w-full text-sm">
                  {workspace.name ?? repositoryLabel(workspace.cwd)}
                </span>
                <span className="line-clamp-1 w-full font-mono text-muted-foreground text-xs">
                  {workspace.cwd}
                </span>
              </button>
            ))}
            {canChooseDirectory && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  void handleChooseDirectory();
                }}
                className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-64"
              >
                <FolderPlusIcon className="size-4 text-muted-foreground" />
                <span className="text-sm">{t('chooseDirectory')}</span>
              </button>
            )}
            {error != null && (
              <div className="px-2 py-1 text-destructive text-xs">
                {t('registerWorkspaceError', { message: extractErrorMessage(error, false) ?? '' })}
              </div>
            )}
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}

function SidebarMenuButton({
  icon,
  label,
  shortcut,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick?: () => void;
}): React.ReactNode {
  return (
    <button
      type="button"
      className={shellSidebarItemClassName}
      disabled={disabled}
      onClick={onClick}
    >
      <SidebarMenuButtonContent icon={icon} label={label} shortcut={shortcut} />
    </button>
  );
}

function SidebarMenuButtonContent({
  icon,
  label,
  shortcut,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
}): React.ReactNode {
  return (
    <>
      <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut && <span className="font-mono text-muted-foreground text-xs">{shortcut}</span>}
    </>
  );
}

export function DefaultHostFooter({
  state,
  latency,
}: {
  state?: string;
  latency?: string;
}): React.ReactNode {
  if (!latency) return <HostFooter state={state} />;

  return (
    <div className="flex h-10 shrink-0 items-center gap-[var(--lc-sidebar-gap,0.5rem)] border-sidebar-border border-t px-[var(--lc-chrome-edge,1rem)] text-xs">
      <span className="size-2 rounded-full bg-success" />
      <span className="font-medium text-sidebar-foreground">Local Host</span>
      {state && <span className="text-muted-foreground">{state}</span>}
      {latency && <span className="text-muted-foreground">{latency}</span>}
      <ChevronDownIcon className="ml-auto size-3.5 text-muted-foreground" />
    </div>
  );
}

export function HostFooter({
  state,
  appVersion,
  pendingPermissionCount = 0,
  onOpenSettings,
}: {
  state?: string;
  appVersion?: string;
  pendingPermissionCount?: number;
  onOpenSettings?: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const pendingPermissionLabel =
    pendingPermissionCount === 1 ? '1 pending' : `${pendingPermissionCount} pending`;

  return (
    <Popover>
      <PopoverTrigger className="flex h-10 w-full items-center gap-(--lc-chrome-section-gap) border-sidebar-border border-t px-(--lc-chrome-edge) text-left text-xs outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring">
        <span className="size-2 rounded-full bg-success" />
        <span className="font-medium text-sidebar-foreground">Local Host</span>
        {state && <span className="text-muted-foreground">{state}</span>}
        <ChevronDownIcon className="ml-auto size-3.5 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPopup side="top" align="start" sideOffset={8} className="w-80 text-sm">
        <div className="flex items-center gap-2 py-1.5">
          <span className="size-2 rounded-full bg-success" />
          <span className="font-semibold">Local Host</span>
          {state && (
            <Badge size="sm" variant="success">
              {state}
            </Badge>
          )}
          {appVersion && (
            <span className="ml-auto font-mono text-muted-foreground text-xs">{appVersion}</span>
          )}
        </div>

        <Separator className="my-1" />

        <HostFooterRow label="Remote access">
          <Badge size="sm" variant="secondary">
            Off
          </Badge>
          <Button disabled size="xs" variant="outline">
            Enable
          </Button>
        </HostFooterRow>
        <HostFooterRow label="Permission requests">
          <span className="text-muted-foreground text-xs">{pendingPermissionLabel}</span>
        </HostFooterRow>

        <Separator className="my-1" />

        <HostFooterRow label="Agent availability">
          <span className="text-muted-foreground text-xs">Not reported</span>
        </HostFooterRow>

        <Separator className="my-1" />

        <div className="flex items-center gap-2 pt-1">
          <Select defaultValue="arcbox" items={ORGS}>
            <SelectTrigger
              disabled
              aria-label={t('organization')}
              className="min-w-0 flex-1"
              size="sm"
            >
              <Avatar className="size-5 rounded-sm">
                <AvatarFallback className="rounded-sm bg-primary text-primary-foreground">
                  A
                </AvatarFallback>
              </Avatar>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {ORGS.map((org) => (
                <SelectItem key={org.value} value={org.value}>
                  {org.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Button
            disabled={!onOpenSettings}
            size="icon-sm"
            variant="outline"
            aria-label="Settings"
            onClick={onOpenSettings}
          >
            <SettingsIcon />
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function HostFooterRow({
  label,
  children,
}: {
  label: string;
  children?: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="flex h-8 items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
    </div>
  );
}

export function EmptyHostFooter(): React.ReactNode {
  return (
    <div className="flex h-10 shrink-0 items-center gap-[var(--lc-sidebar-gap,0.5rem)] border-sidebar-border border-t px-[var(--lc-chrome-edge,1rem)] text-muted-foreground text-xs">
      <BotIcon className="size-3.5" />
      Local Host
    </div>
  );
}
