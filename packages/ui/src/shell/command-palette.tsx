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
import type { Transition } from 'motion/react';
import { motion, useReducedMotion } from 'motion/react';
import { Fragment, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { AgentIcon } from '../chat/agent-icon';
import { useKeyboardShortcut } from '../keyboard';
import { preventBaseUIHandler } from '../lib/base-ui';
import { cn } from '../lib/cn';
import { SESSION_STATUS_DOT_CLASS } from './sidebar/thread-row';

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
  /** Fires with `false` on Escape/backdrop dismissal; closing happens by unmounting (the caller's `AnimatePresence` plays the exit). */
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

/**
 * Registers one ⌘n binding scoped to the open palette, so pressing it selects the nth Recent row.
 * Own component per slot because hooks cannot be registered in a loop. An empty slot yields the
 * event (returns false) rather than swallowing it.
 */
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

/**
 * Dialog chrome forked from coss-ui's `CommandDialogBackdrop`/`CommandDialogPopup`: motion owns
 * enter/exit here (the workbench container defers unmount via `AnimatePresence`), so the CSS
 * `data-starting/ending-style` transition classes are dropped, and the backdrop loses
 * `backdrop-blur-sm` — backdrop-filter cannot blur the native vibrancy behind the desktop's
 * translucent sidebar, where it reads as a milky seam instead.
 */
const BACKDROP_CLASS = 'fixed inset-0 z-50 bg-black/32';
const POPUP_CLASS =
  'relative flex max-h-105 min-h-0 w-full min-w-0 max-w-xl flex-col rounded-2xl border bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:bg-muted/72 before:shadow-[0_1px_--theme(--color-black/4%)] **:data-[slot=scroll-area-viewport]:data-has-overflow-y:pe-1 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]';

/** Intrinsic height of an element, observed so the list wrapper can animate to it. */
function useMeasuredHeight(): [React.RefCallback<HTMLElement>, number | null] {
  const [height, setHeight] = useState<number | null>(null);
  const measureRef = (element: HTMLElement | null): (() => void) | undefined => {
    if (!element) return undefined;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  };
  return [measureRef, height];
}

/**
 * The ⌘K palette dialog: the canonical coss-ui command sandwich — input on the popup's muted
 * surface, a raised panel holding the grouped results, a Kbd-hint footer. Items are pre-ranked
 * by the caller (`mode="none"`); Base UI owns keyboard navigation and Enter-activates-the-
 * highlighted-item, so rows only need `onClick`.
 */
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
  const reducedMotion = useReducedMotion();
  const [listRef, listHeight] = useMeasuredHeight();
  // Owner for the ⌘1–⌘9 row jumps: the popup is the active surface while the palette is open
  // (the workbench root that carries the global bindings is `data-base-ui-inert` here), so these
  // are what make the visible Recent-row hints actually select from the open dialog.
  const popupRef = useRef<HTMLDivElement>(null);

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

  const dialogTransition: Transition = reducedMotion
    ? { duration: 0 }
    : { duration: 0.2, ease: 'easeInOut' };

  return (
    <CommandDialog open onOpenChange={onOpenChange}>
      <CommandDialogPortal>
        <CommandDialogPrimitive.Backdrop
          className={BACKDROP_CLASS}
          data-slot="command-dialog-backdrop"
          render={
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={dialogTransition}
            />
          }
        />
        <CommandDialogViewport>
          <CommandDialogPrimitive.Popup
            className={POPUP_CLASS}
            data-slot="command-dialog-popup"
            render={
              <motion.div
                ref={popupRef}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={dialogTransition}
              />
            }
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
                <motion.div
                  className="min-h-0"
                  initial={false}
                  animate={listHeight === null ? undefined : { height: listHeight }}
                  transition={reducedMotion ? { duration: 0 } : { duration: 0.15, ease: 'easeOut' }}
                >
                  <CommandList ref={listRef}>
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
                </motion.div>
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
