import type { AgentKind, SessionId, SessionStatus } from '@linkcode/schema';
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPortal,
  CommandDialogPrimitive,
  CommandDialogViewport,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
} from 'coss-ui/components/command';
import { Kbd, KbdGroup } from 'coss-ui/components/kbd';
import { ArrowDownIcon, ArrowUpIcon, CornerDownLeftIcon } from 'lucide-react';
import { Fragment, useRef } from 'react';
import { useTranslations } from 'use-intl';
import { AgentIcon } from '../chat/agent-icon';
import { useKeyboardShortcut } from '../keyboard';
import { preventBaseUIHandler } from '../lib/base-ui';
import { cn } from '../lib/cn';
import { SESSION_STATUS_DOT_CLASS } from './sidebar/thread-status';

export interface PaletteThreadViewModel {
  sessionId: SessionId;
  title: string;
  kind: AgentKind;
  status: SessionStatus;
  /** Workspace badge on the row's right edge; `null` for chat/unregistered threads. */
  workspaceLabel: string | null;
  /** Platform-formatted jump hint, e.g. `⌘1` — display only, set on the Recent view. */
  shortcut?: string;
}

export interface PaletteCommandViewModel {
  id: string;
  label: string;
  /** Platform-formatted hint, e.g. `⌘,` — display only. */
  shortcut?: string;
}

export interface CommandPaletteProps {
  /** Fires with `false` on Escape, Command+K, or backdrop dismissal. */
  onOpenChange: (open: boolean) => void;
  /** Controlled query — filtering/ranking happens upstream, never inside the dialog. */
  query: string;
  onQueryChange: (query: string) => void;
  threads: readonly PaletteThreadViewModel[];
  commands: readonly PaletteCommandViewModel[];
  onSelectThread: (id: SessionId) => void;
  onRunCommand: (id: string) => void;
}

interface ThreadPaletteEntry {
  kind: 'thread';
  thread: PaletteThreadViewModel;
}

interface CommandPaletteEntry {
  kind: 'command';
  command: PaletteCommandViewModel;
}

type PaletteEntry = ThreadPaletteEntry | CommandPaletteEntry;

interface PaletteGroup {
  value: string;
  label: string;
  items: PaletteEntry[];
}

function paletteEntryToString(item: unknown): string {
  const entry = item as PaletteEntry;
  return entry.kind === 'thread' ? entry.thread.title : entry.command.label;
}

/** ⌘1–⌘9 slots, matching the palette's Recent-list cap. */
const RECENT_JUMP_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** One ⌘n binding selecting the nth Recent row (own component per slot — hooks can't register
 * in a loop). An empty slot yields the event (returns false) rather than swallowing it. */
function RecentThreadJumpBinding({
  slot,
  owner,
  thread,
  onSelect,
}: {
  slot: number;
  owner: React.RefObject<Element | null>;
  thread: PaletteThreadViewModel | undefined;
  onSelect: (id: SessionId) => void;
}): null {
  useKeyboardShortcut({
    actionId: `palette.jump-recent-thread-${slot}`,
    shortcut: { code: `Digit${slot}`, modifiers: ['primary'] },
    owner,
    handler() {
      if (thread === undefined) return false;
      onSelect(thread.sessionId);
      return true;
    },
  });
  return null;
}

/** Dialog chrome without coss-ui's transitions; backdrop blur cannot blur native vibrancy. */
const BACKDROP_CLASS = 'fixed inset-0 z-50 bg-black/32';
const POPUP_CLASS =
  'relative flex max-h-105 min-h-0 w-full min-w-0 max-w-xl flex-col rounded-2xl border bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:bg-muted/72 before:shadow-[0_1px_--theme(--color-black/4%)] **:data-[slot=scroll-area-viewport]:data-has-overflow-y:pe-1 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]';

/** The ⌘K palette dialog. Items are pre-ranked by the caller (`mode="none"`); Base UI owns
 * keyboard navigation and Enter-activation, so rows only need `onClick`. */
export function CommandPalette({
  onOpenChange,
  query,
  onQueryChange,
  threads,
  commands,
  onSelectThread,
  onRunCommand,
}: CommandPaletteProps): React.ReactNode {
  const t = useTranslations('workbench.palette');
  // The workbench shortcut owner is inert while the dialog is open, so popup-local bindings own
  // Command+K dismissal and the ⌘1–⌘9 jumps.
  const popupRef = useRef<HTMLDivElement>(null);

  useKeyboardShortcut({
    actionId: 'workbench.command-palette',
    shortcut: { code: 'KeyK', modifiers: ['primary'] },
    owner: popupRef,
    handler() {
      onOpenChange(false);
      return true;
    },
  });

  const groups: PaletteGroup[] = [];
  if (threads.length > 0) {
    groups.push({
      value: 'threads',
      label: query ? t('threadsGroup') : t('recentGroup'),
      items: threads.map((thread) => ({ kind: 'thread', thread })),
    });
  }
  if (commands.length > 0) {
    groups.push({
      value: 'commands',
      label: query ? t('commandsGroup') : t('suggestedGroup'),
      items: commands.map((command) => ({ kind: 'command', command })),
    });
  }

  return (
    <CommandDialog open onOpenChange={onOpenChange}>
      <CommandDialogPortal>
        <CommandDialogPrimitive.Backdrop
          className={BACKDROP_CLASS}
          data-slot="command-dialog-backdrop"
        />
        <CommandDialogViewport>
          <CommandDialogPrimitive.Popup
            ref={popupRef}
            className={POPUP_CLASS}
            data-slot="command-dialog-popup"
          >
            {/* ⌘1–⌘9 select the nth Recent row while the palette is open. Only on the empty-query
                Recent view — a filtered ranking no longer lines up with the digit hints. */}
            {query === '' &&
              RECENT_JUMP_SLOTS.map((slot) => (
                <RecentThreadJumpBinding
                  key={slot}
                  slot={slot}
                  owner={popupRef}
                  thread={threads[slot - 1]}
                  onSelect={onSelectThread}
                />
              ))}
            <Command
              mode="none"
              items={groups}
              itemToStringValue={paletteEntryToString}
              value={query}
              onValueChange={onQueryChange}
            >
              <CommandInput placeholder={t('placeholder')} />
              <CommandPanel className="flex flex-col">
                <CommandEmpty>{t('empty')}</CommandEmpty>
                <div className="min-h-0">
                  <CommandList>
                    {(group: PaletteGroup) => (
                      <Fragment key={group.value}>
                        <CommandGroup items={group.items}>
                          <CommandGroupLabel>{group.label}</CommandGroupLabel>
                          <CommandCollection>
                            {(entry: PaletteEntry) =>
                              entry.kind === 'thread' ? (
                                <PaletteThreadRow
                                  key={entry.thread.sessionId}
                                  entry={entry}
                                  onSelect={onSelectThread}
                                />
                              ) : (
                                <PaletteCommandRow
                                  key={entry.command.id}
                                  entry={entry}
                                  onRun={onRunCommand}
                                />
                              )
                            }
                          </CommandCollection>
                        </CommandGroup>
                        <CommandSeparator />
                      </Fragment>
                    )}
                  </CommandList>
                </div>
              </CommandPanel>
              <CommandFooter>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <KbdGroup>
                      <Kbd>
                        <ArrowUpIcon />
                      </Kbd>
                      <Kbd>
                        <ArrowDownIcon />
                      </Kbd>
                    </KbdGroup>
                    <span>{t('footerNavigate')}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Kbd>
                      <CornerDownLeftIcon />
                    </Kbd>
                    <span>{t('footerOpen')}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Kbd>Esc</Kbd>
                  <span>{t('footerClose')}</span>
                </div>
              </CommandFooter>
            </Command>
          </CommandDialogPrimitive.Popup>
        </CommandDialogViewport>
      </CommandDialogPortal>
    </CommandDialog>
  );
}

function PaletteThreadRow({
  entry,
  onSelect,
}: {
  entry: ThreadPaletteEntry;
  onSelect: (id: SessionId) => void;
}): React.ReactNode {
  const { thread } = entry;
  return (
    <CommandItem
      value={entry}
      className="gap-2"
      onClick={(event) => {
        preventBaseUIHandler(event);
        onSelect(thread.sessionId);
      }}
    >
      <span className="relative shrink-0">
        <AgentIcon kind={thread.kind} variant="ghost" className="text-muted-foreground" />
        <span
          aria-hidden
          className={cn(
            'absolute -right-1 -bottom-1 size-1.5 rounded-full ring-2 ring-popover transition-colors in-data-highlighted:ring-accent',
            SESSION_STATUS_DOT_CLASS[thread.status],
          )}
        />
      </span>
      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
      {thread.workspaceLabel && (
        <span className="shrink-0 text-muted-foreground text-xs">{thread.workspaceLabel}</span>
      )}
      {thread.shortcut && <CommandShortcut>{thread.shortcut}</CommandShortcut>}
    </CommandItem>
  );
}

function PaletteCommandRow({
  entry,
  onRun,
}: {
  entry: CommandPaletteEntry;
  onRun: (id: string) => void;
}): React.ReactNode {
  const { command } = entry;
  return (
    <CommandItem
      value={entry}
      className="gap-2"
      onClick={(event) => {
        preventBaseUIHandler(event);
        onRun(command.id);
      }}
    >
      <span className="min-w-0 flex-1 truncate">{command.label}</span>
      {command.shortcut && <CommandShortcut>{command.shortcut}</CommandShortcut>}
    </CommandItem>
  );
}
