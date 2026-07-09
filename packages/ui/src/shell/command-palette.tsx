import type { AgentKind, SessionId, SessionStatus } from '@linkcode/schema';
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
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
import { motion, useReducedMotion } from 'motion/react';
import { Fragment, useState } from 'react';
import { useTranslations } from 'use-intl';
import { AgentIcon } from '../chat/agent-icon';
import { cn } from '../lib/cn';
import { preventBaseUIHandler } from './composer-command';
import { SESSION_STATUS_DOT_CLASS } from './sidebar/thread-row';

export interface PaletteThreadViewModel {
  sessionId: SessionId;
  title: string;
  kind: AgentKind;
  status: SessionStatus;
  /** Workspace badge on the row's right edge; `null` for chat/unregistered threads. */
  workspaceLabel: string | null;
}

export interface PaletteCommandViewModel {
  id: string;
  label: string;
  /** Platform-formatted hint, e.g. `⌘,` — display only. */
  shortcut?: string;
}

export interface CommandPaletteProps {
  open: boolean;
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
  open,
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
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup>
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
      </CommandDialogPopup>
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
