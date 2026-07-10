import type { SessionId, WorkspaceRecord } from '@linkcode/schema';
import { Avatar, AvatarFallback, AvatarImage } from 'coss-ui/components/avatar';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Kbd } from 'coss-ui/components/kbd';
import { Popover, PopoverPopup, PopoverTrigger } from 'coss-ui/components/popover';
import { Separator } from 'coss-ui/components/separator';
import {
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from 'coss-ui/components/sidebar';
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  CloudIcon,
  ExternalLinkIcon,
  FilePlus2Icon,
  LogOutIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
} from 'lucide-react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { ShellSidebar } from './shell-sidebar';
import type { ThreadGroupActions, ThreadGroupState } from './sidebar';
import type { ThreadGroupViewModel } from './threads-view';
import { ThreadsView } from './threads-view';

export { repositoryLabel } from './repository-label';
export type { ThreadGroupViewModel } from './threads-view';

export interface SessionSidebarProps extends ThreadGroupActions, ThreadGroupState {
  threadGroups: ThreadGroupViewModel[];
  workspacesLoading?: boolean;
  /** First load of the session list — the "Chats" section shows a skeleton, not the empty hint. */
  sessionsLoading?: boolean;
  topInsetClassName?: string;
  footer?: React.ReactNode;
  className?: string;
  /** Persists a group drag: the full new project-group order, as `collapseKey`s. */
  onReorderGroups: (orderedCollapseKeys: string[]) => void;
  /** Persists a thread drag within a group: `activeId` landed before/after `overId`. */
  onReorderThreads: (
    collapseKey: string,
    activeId: SessionId,
    overId: SessionId,
    placement: 'before' | 'after',
  ) => void;
  /** Opens the native directory picker; desktop only — omit to keep the manual path field only. */
  onPickDirectory?: () => Promise<string | null>;
  /** Opens the command palette — the Search entry stays disabled without it. */
  onOpenSearch?: () => void;
  /** Platform-formatted hint next to the Search entry, e.g. `⌘K`. */
  searchShortcut?: string;
  /** Registers a directory as a workspace — the Add workspace row. */
  onRegisterWorkspace: (cwd: string) => Promise<WorkspaceRecord>;
}

/** The signed-in LinkCode Cloud account rendered in the footer; null/undefined when signed out. */
export interface CloudAccount {
  name: string;
  email: string;
  image?: string | null;
}

/** An online remote host in the footer's Remote access list. */
export interface RemoteHostItem {
  id: string;
  name: string;
  /** Preformatted relative-activity label, e.g. "active 5s ago". */
  statusLabel?: string;
}

export function SessionSidebar({
  threadGroups,
  workspacesLoading,
  sessionsLoading,
  activeId,
  pinnedSessionIds,
  topInsetClassName,
  footer,
  className,
  onSelect,
  onClose,
  onToggleSessionPinned,
  onReorderGroups,
  onReorderThreads,
  onStartDraft,
  onPickDirectory,
  onOpenSearch,
  searchShortcut,
  onRegisterWorkspace,
  onRenameWorkspace,
  onArchiveWorkspace,
  onToggleGroupCollapsed,
  onTogglePreviewExpanded,
  BranchStatusComponent,
}: SessionSidebarProps): React.ReactNode {
  return (
    <ShellSidebar
      className={className}
      topInset={
        topInsetClassName ? <div aria-hidden className={cn('shrink-0', topInsetClassName)} /> : null
      }
      footer={footer}
    >
      <SidebarHeader className="pb-1">
        <SidebarMenu className="gap-0.5">
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => onStartDraft()}>
              <FilePlus2Icon className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">New Task</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton disabled={!onOpenSearch} onClick={onOpenSearch}>
              <SearchIcon className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">Search</span>
              {searchShortcut && <Kbd>{searchShortcut}</Kbd>}
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton disabled>
              <SparklesIcon className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">Automation</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <ThreadsView
          groups={threadGroups}
          workspacesLoading={workspacesLoading}
          sessionsLoading={sessionsLoading}
          activeId={activeId}
          pinnedSessionIds={pinnedSessionIds}
          onSelect={onSelect}
          onClose={onClose}
          onToggleSessionPinned={onToggleSessionPinned}
          onReorderGroups={onReorderGroups}
          onReorderThreads={onReorderThreads}
          onStartDraft={onStartDraft}
          onPickDirectory={onPickDirectory}
          onRegisterWorkspace={onRegisterWorkspace}
          onRenameWorkspace={onRenameWorkspace}
          onArchiveWorkspace={onArchiveWorkspace}
          onToggleGroupCollapsed={onToggleGroupCollapsed}
          onTogglePreviewExpanded={onTogglePreviewExpanded}
          BranchStatusComponent={BranchStatusComponent}
        />
      </SidebarContent>
    </ShellSidebar>
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
  account,
  authPending = false,
  onSignIn,
  onSignOut,
  onManageAccount,
  remoteHosts,
  remoteHostsLoading = false,
  selectedHostId,
  onSelectHost,
  onOpenSettings,
}: {
  state?: string;
  appVersion?: string;
  pendingPermissionCount?: number;
  /** LinkCode Cloud account; null/undefined renders the signed-out sign-in button. */
  account?: CloudAccount | null;
  /** Sign-in in flight (browser handoff): disables the button and shows a spinner. */
  authPending?: boolean;
  onSignIn?: () => void;
  onSignOut?: () => void;
  /** Opens the IdP account center (profile/avatar) in the system browser; shown when signed in. */
  onManageAccount?: () => void;
  /** The account's online hosts (Remote access); undefined until first load. Requires `account`. */
  remoteHosts?: RemoteHostItem[];
  /** First load of the host list — the Remote access area shows a checking hint, not "no hosts". */
  remoteHostsLoading?: boolean;
  /** The currently selected host id, if any. */
  selectedHostId?: string | null;
  onSelectHost?: (hostId: string) => void;
  onOpenSettings?: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const tPalette = useTranslations('workbench.palette');
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

        <div className="py-1">
          <div className="flex h-8 items-center gap-2">
            <span className="min-w-0 flex-1 truncate">Remote access</span>
            {!account && (
              <span className="text-muted-foreground text-xs">{t('remoteSignedOut')}</span>
            )}
          </div>
          {account && (
            <RemoteHostList
              hosts={remoteHosts}
              loading={remoteHostsLoading}
              selectedHostId={selectedHostId}
              onSelectHost={onSelectHost}
              loadingLabel={t('remoteHostsLoading')}
              emptyLabel={t('remoteHostsEmpty')}
            />
          )}
        </div>
        <HostFooterRow label="Permission requests">
          <span className="text-muted-foreground text-xs">{pendingPermissionLabel}</span>
        </HostFooterRow>

        <Separator className="my-1" />

        <HostFooterRow label="Agent availability">
          <span className="text-muted-foreground text-xs">Not reported</span>
        </HostFooterRow>

        <Separator className="my-1" />

        <div className="flex items-center gap-2 pt-1">
          {account ? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Avatar className="size-6">
                {account.image && <AvatarImage src={account.image} alt={account.name} />}
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {accountInitial(account)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate font-medium">{account.name}</div>
                <div className="truncate text-muted-foreground text-xs">{account.email}</div>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={t('manageAccount')}
                disabled={!onManageAccount}
                onClick={onManageAccount}
              >
                <ExternalLinkIcon />
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label={t('signOut')} onClick={onSignOut}>
                <LogOutIcon />
              </Button>
            </div>
          ) : (
            <Button
              className="min-w-0 flex-1 justify-start"
              size="sm"
              variant="outline"
              loading={authPending}
              disabled={!onSignIn}
              onClick={onSignIn}
            >
              <CloudIcon />
              {t('signInCloud')}
            </Button>
          )}
          <Button
            disabled={!onOpenSettings}
            size="icon-sm"
            variant="outline"
            aria-label={tPalette('openSettings')}
            onClick={onOpenSettings}
          >
            <SettingsIcon />
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function accountInitial(account: CloudAccount): string {
  return (account.name || account.email).trim().charAt(0).toUpperCase() || '?';
}

function RemoteHostList({
  hosts,
  loading,
  selectedHostId,
  onSelectHost,
  loadingLabel,
  emptyLabel,
}: {
  hosts?: RemoteHostItem[];
  loading: boolean;
  selectedHostId?: string | null;
  onSelectHost?: (hostId: string) => void;
  loadingLabel: string;
  emptyLabel: string;
}): React.ReactNode {
  if (!hosts || hosts.length === 0) {
    return (
      <div className="px-1 py-1 text-muted-foreground text-xs">
        {loading && !hosts ? loadingLabel : emptyLabel}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {hosts.map((host) => {
        const selected = host.id === selectedHostId;
        return (
          <button
            key={host.id}
            type="button"
            disabled={!onSelectHost}
            onClick={() => onSelectHost?.(host.id)}
            className={cn(
              'flex h-8 items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring',
              selected && 'bg-sidebar-accent',
            )}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-success" />
            <span className="min-w-0 flex-1 truncate font-medium">{host.name}</span>
            {host.statusLabel && (
              <span className="shrink-0 text-muted-foreground text-xs">{host.statusLabel}</span>
            )}
            {selected && <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" />}
          </button>
        );
      })}
    </div>
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
