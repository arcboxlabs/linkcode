import type { AgentKind, SessionId, SessionStatus } from '@linkcode/schema';
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
} from 'coss-ui/components/command';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { AgentIcon } from './agent-icon';
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

/**
 * The ⌘K palette dialog: one input, a Threads group and a command group, pre-ranked by the
 * caller. Built on coss-ui's Command (Base UI Dialog + Autocomplete); Base UI owns keyboard
 * navigation and Enter-activates-the-highlighted-item, so rows only need `onClick`.
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
  const hasResults = threads.length > 0 || commands.length > 0;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup>
        <Command mode="none">
          <CommandPanel>
            <CommandInput
              placeholder={t('placeholder')}
              value={query}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
            />
            <CommandList>
              {threads.length > 0 && (
                <CommandGroup>
                  <CommandGroupLabel>
                    {query ? t('threadsGroup') : t('recentGroup')}
                  </CommandGroupLabel>
                  {threads.map((thread) => (
                    <PaletteThreadRow
                      key={thread.sessionId}
                      thread={thread}
                      onSelect={() => onSelectThread(thread.sessionId)}
                    />
                  ))}
                </CommandGroup>
              )}
              {threads.length > 0 && commands.length > 0 && <CommandSeparator />}
              {commands.length > 0 && (
                <CommandGroup>
                  <CommandGroupLabel>
                    {query ? t('commandsGroup') : t('suggestedGroup')}
                  </CommandGroupLabel>
                  {commands.map((command) => (
                    <CommandItem
                      key={command.id}
                      value={`command:${command.id}`}
                      className="cursor-pointer gap-2"
                      onMouseDown={(event) => {
                        event.preventDefault();
                      }}
                      onClick={() => onRunCommand(command.id)}
                    >
                      <span className="min-w-0 flex-1 truncate">{command.label}</span>
                      {command.shortcut && <CommandShortcut>{command.shortcut}</CommandShortcut>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {!hasResults && <CommandEmpty>{t('empty')}</CommandEmpty>}
            </CommandList>
          </CommandPanel>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function PaletteThreadRow({
  thread,
  onSelect,
}: {
  thread: PaletteThreadViewModel;
  onSelect: () => void;
}): React.ReactNode {
  return (
    <CommandItem
      value={`thread:${thread.sessionId}`}
      className="cursor-pointer gap-2"
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onSelect}
    >
      <span className="relative shrink-0">
        <AgentIcon kind={thread.kind} variant="ghost" className="text-muted-foreground" />
        <span
          aria-hidden
          className={cn(
            'absolute -right-1 -bottom-1 size-1.5 rounded-full ring-2 ring-popover',
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
