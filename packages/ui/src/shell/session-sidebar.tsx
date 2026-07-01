import type { AgentKind, SessionId, SessionInfo } from '@linkcode/schema';
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
import { addDays } from 'date-fns/addDays';
import { startOfDay } from 'date-fns/startOfDay';
import { subDays } from 'date-fns/subDays';
import {
  BotIcon,
  ChevronDownIcon,
  FilePlus2Icon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import { AGENT_LABELS, AgentIcon } from './agent-icon';
import { ShellSidebar, shellSidebarItemClassName } from './shell-sidebar';

export interface SessionSidebarProps {
  sessions: SessionInfo[];
  activeId: SessionId | null;
  topInsetClassName?: string;
  footer?: React.ReactNode;
  className?: string;
  onSelect: (id: SessionId) => void;
  onStop: (id: SessionId) => void;
  onCreate: (kind: AgentKind) => void;
}

export type SessionGroupKey = 'today' | 'yesterday' | 'earlier';

const GROUP_LABELS: Record<SessionGroupKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
};

const ORGS = [{ label: 'ArcBox Labs', value: 'arcbox' }];

const ROOT_PATH_RE = /^[\\/]+$/;
const PATH_SEPARATOR_RE = /[\\/]+/;
const WINDOWS_DRIVE_LABEL_RE = /^[a-z]:$/i;
const WINDOWS_DRIVE_ROOT_RE = /^[a-z]:[\\/]*$/i;

export function SessionSidebar({
  sessions,
  activeId,
  topInsetClassName,
  footer,
  className,
  onSelect,
  onStop,
  onCreate,
}: SessionSidebarProps): React.ReactNode {
  const currentDayStart = useCurrentLocalDayStart();
  const groups = useMemo(
    () => groupSessions(sessions, currentDayStart),
    [currentDayStart, sessions],
  );

  return (
    <ShellSidebar
      className={className}
      topInset={
        topInsetClassName ? <div aria-hidden className={cn('shrink-0', topInsetClassName)} /> : null
      }
      footer={footer}
    >
      <div className="px-[var(--lc-sidebar-edge,0.5rem)]">
        <NewTaskMenu onCreate={onCreate} />
        <SidebarMenuButton disabled icon={<SearchIcon />} label="Search" />
        <SidebarMenuButton disabled icon={<SparklesIcon />} label="Automation" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-[var(--lc-sidebar-edge,0.5rem)] pt-[var(--lc-sidebar-edge,0.5rem)] pb-[var(--lc-sidebar-edge,0.5rem)]">
          {sessions.length === 0 ? (
            <div className="px-[calc(var(--lc-sidebar-edge,0.5rem)+0.25rem)] py-6 text-center text-muted-foreground text-sm">
              No sessions yet
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((group) => (
                <SessionGroup
                  key={group.key}
                  group={group}
                  activeId={activeId}
                  onSelect={onSelect}
                  onStop={onStop}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </ShellSidebar>
  );
}

function NewTaskMenu({ onCreate }: { onCreate: (kind: AgentKind) => void }): React.ReactNode {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={shellSidebarItemClassName}>
        <SidebarMenuButtonContent icon={<FilePlus2Icon />} label="New Task" />
      </PopoverTrigger>
      <PopoverPopup align="start" side="right" sideOffset={8} className="w-64 p-0">
        <div className="p-1">
          <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">New task</div>
          {(Object.keys(AGENT_LABELS) as AgentKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                setOpen(false);
                onCreate(kind);
              }}
            >
              <AgentIcon kind={kind} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{AGENT_LABELS[kind]}</span>
                <span className="block truncate text-muted-foreground text-xs">
                  Choose a working folder
                </span>
              </span>
            </button>
          ))}
        </div>
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

function SessionGroup({
  group,
  activeId,
  onSelect,
  onStop,
}: {
  group: SessionGroupData;
  activeId: SessionId | null;
  onSelect: (id: SessionId) => void;
  onStop: (id: SessionId) => void;
}): React.ReactNode {
  return (
    <section>
      <div className="flex h-6 items-center gap-[var(--lc-sidebar-gap,0.5rem)] px-[var(--lc-sidebar-edge,0.5rem)] text-muted-foreground text-xs">
        <span>{GROUP_LABELS[group.key]}</span>
        <span className="tabular-nums">{group.sessions.length}</span>
      </div>
      <div className="space-y-0.5">
        {group.sessions.map((session) => (
          <CompactSessionRow
            key={session.sessionId}
            active={session.sessionId === activeId}
            session={session}
            onSelect={() => onSelect(session.sessionId)}
            onStop={() => onStop(session.sessionId)}
          />
        ))}
      </div>
    </section>
  );
}

export function CompactSessionRow({
  session,
  active,
  onSelect,
  onStop,
}: {
  session: SessionInfo;
  active: boolean;
  onSelect: () => void;
  onStop: () => void;
}): React.ReactNode {
  const repo = repositoryLabel(session.cwd);
  const agent = AGENT_LABELS[session.kind];
  const title = `${agent} in ${repo}`;

  return (
    <div
      className={cn(
        'group relative rounded-md',
        active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/70',
      )}
    >
      {active && <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-primary" />}
      <button
        type="button"
        className="flex w-full min-w-0 gap-[var(--lc-sidebar-gap,0.5rem)] rounded-md px-[var(--lc-sidebar-edge,0.5rem)] py-1.5 pr-8 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
      >
        <AgentIcon kind={session.kind} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 font-medium text-sm leading-snug">{title}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1 font-mono text-muted-foreground text-xs">
            <span className="truncate">{repo}</span>
            <span>/</span>
            <span>local</span>
          </span>
        </span>
        <span className="shrink-0 pt-0.5 text-muted-foreground text-xs tabular-nums">
          {timeLabel(session.createdAt)}
        </span>
      </button>
      <button
        type="button"
        aria-label="Stop session"
        title="Stop session"
        onClick={onStop}
        className="-translate-y-1/2 absolute top-1/2 right-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

export interface SessionGroupData {
  key: SessionGroupKey;
  sessions: SessionInfo[];
}

export function groupSessions(
  sessions: readonly SessionInfo[],
  currentDayStart = startOfDay(Date.now()).getTime(),
): SessionGroupData[] {
  const groups: Record<SessionGroupKey, SessionInfo[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  };

  for (const session of [...sessions].sort((a, b) => b.createdAt - a.createdAt)) {
    groups[groupKey(session.createdAt, currentDayStart)].push(session);
  }

  return (['today', 'yesterday', 'earlier'] as const).reduce<SessionGroupData[]>((items, key) => {
    if (groups[key].length > 0) items.push({ key, sessions: groups[key] });
    return items;
  }, []);
}

function groupKey(timestamp: number, currentDayStart: number): SessionGroupKey {
  const startYesterday = subDays(currentDayStart, 1).getTime();

  if (timestamp >= currentDayStart) return 'today';
  if (timestamp >= startYesterday) return 'yesterday';
  return 'earlier';
}

export function repositoryLabel(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) return cwd;
  if (ROOT_PATH_RE.test(trimmed)) return trimmed[0] === '\\' ? '\\' : '/';

  const parts = trimmed.split(PATH_SEPARATOR_RE).filter(Boolean);
  const label = parts.at(-1);
  if (!label) return trimmed;
  if (WINDOWS_DRIVE_LABEL_RE.test(label) && WINDOWS_DRIVE_ROOT_RE.test(trimmed)) {
    return `${label}\\`;
  }
  return label;
}

function timeLabel(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function useCurrentLocalDayStart(): number {
  const [currentDayStart, setCurrentDayStart] = useState(() => startOfDay(Date.now()).getTime());

  useEffect(() => {
    let timeoutId: number | null = null;

    const scheduleNextDay = (): void => {
      timeoutId = window.setTimeout(
        () => {
          setCurrentDayStart(startOfDay(Date.now()).getTime());
          scheduleNextDay();
        },
        Math.max(1, addDays(startOfDay(Date.now()), 1).getTime() - Date.now()),
      );
    };

    scheduleNextDay();

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, []);

  return currentDayStart;
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
            <SelectTrigger disabled aria-label="Workspace" className="min-w-0 flex-1" size="sm">
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
