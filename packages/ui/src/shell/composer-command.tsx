import type { AgentCommand, SessionMode } from '@linkcode/schema';
import {
  CommandCollection,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandItem,
  CommandList,
} from 'coss-ui/components/command';
import type { LucideIcon } from 'lucide-react';
import {
  AtSignIcon,
  BookTextIcon,
  CheckIcon,
  ListTodoIcon,
  PaperclipIcon,
  SlashIcon,
  SlidersHorizontalIcon,
  TargetIcon,
} from 'lucide-react';
import type { FileIconComponent } from '../lib/file-icon';
import { fileIconFor } from '../lib/file-icon';

/** A thing the `@` menu can mention. The data source is pluggable; today the apps pass none. */
export interface MentionItem {
  id: string;
  value: string;
  label: string;
  hint?: string;
}

export type ComposerCommandSource = 'mention' | 'plus' | 'slash';

interface BaseCommandEntry {
  disabled?: boolean;
  hint?: string;
  icon?: FileIconComponent;
  id: string;
  label: string;
  source: ComposerCommandSource;
  value: string;
}

export interface MentionCommandEntry extends BaseCommandEntry {
  kind: 'mention';
  mention: MentionItem;
}

interface ActionCommandEntry extends BaseCommandEntry {
  icon: LucideIcon;
  kind: 'action';
}

export interface ModeCommandEntry extends BaseCommandEntry {
  active: boolean;
  icon: LucideIcon;
  kind: 'mode';
  mode: SessionMode;
}

/** A provider slash command from the session's advertised catalog. */
export interface AgentCommandEntry extends BaseCommandEntry {
  command: AgentCommand;
  kind: 'command';
}

export type ComposerCommandEntry =
  | ActionCommandEntry
  | AgentCommandEntry
  | MentionCommandEntry
  | ModeCommandEntry;

export interface ComposerCommandGroup {
  items: ComposerCommandEntry[];
  label: string;
  value: string;
}

const MODE_COMMAND_ICONS: Record<string, LucideIcon> = {
  goal: TargetIcon,
  plan: ListTodoIcon,
};

export function commandEntryToString(item: unknown): string {
  return (item as ComposerCommandEntry).label;
}

function matchesQuery(
  label: string,
  value: string,
  hint: string | undefined,
  query: string,
): boolean {
  if (query.length === 0) return true;
  return (
    label.toLowerCase().includes(query) ||
    value.toLowerCase().includes(query) ||
    Boolean(hint?.toLowerCase().includes(query))
  );
}

export function buildComposerCommandGroups({
  agentCommands,
  attachEnabled = true,
  availableModes,
  commandSource,
  currentModeId,
  labels,
  mentionItems,
  modesEnabled,
  plusQuery,
  textTrigger,
}: {
  /** The session's advertised slash-command catalog (empty when the agent has none). */
  agentCommands: readonly AgentCommand[];
  /** Whether the active frontend capability stub supports image attachments — the "attach" entry
   * stays visible either way, but disables when the answer is no. */
  attachEnabled?: boolean;
  availableModes: SessionMode[];
  commandSource: ComposerCommandSource | null;
  currentModeId: string | null;
  labels: {
    attach: string;
    commands: string;
    mentions: string;
  };
  mentionItems: MentionItem[];
  modesEnabled: boolean;
  plusQuery: string;
  textTrigger: { query: string } | null;
}): ComposerCommandGroup[] {
  if (!commandSource) return [];

  if (commandSource === 'mention') {
    const query = textTrigger?.query.toLowerCase() ?? '';
    const items = mentionItems.reduce<MentionCommandEntry[]>((matches, mention) => {
      if (matchesQuery(mention.label, mention.value, mention.hint, query)) {
        matches.push({
          hint: mention.hint,
          id: `mention:${mention.id}`,
          icon: fileIconFor({ name: mention.value }),
          kind: 'mention',
          label: mention.label,
          mention,
          source: 'mention',
          value: mention.value,
        });
      }
      return matches;
    }, []);
    return items.length > 0 ? [{ items, label: labels.mentions, value: 'mentions' }] : [];
  }

  const commandQuery =
    commandSource === 'slash' ? (textTrigger?.query.toLowerCase() ?? '') : plusQuery;
  // TODO(commands): replace this inline list with a registry once plugins, skills, MCPs, and
  // other providers can contribute composer commands.
  const commandItemCandidates: ActionCommandEntry[] = [
    {
      disabled: !attachEnabled,
      icon: PaperclipIcon,
      id: 'attach',
      kind: 'action',
      label: labels.attach,
      source: 'plus',
      value: 'attach',
    },
    {
      disabled: agentCommands.length === 0,
      icon: SlashIcon,
      id: 'slash-command',
      kind: 'action',
      label: labels.commands,
      source: 'plus',
      value: 'command',
    },
    {
      icon: AtSignIcon,
      id: 'mention-command',
      kind: 'action',
      label: labels.mentions,
      source: 'plus',
      value: 'mention',
    },
  ];
  const commandItems: ComposerCommandEntry[] = [];
  if (commandSource === 'slash') {
    for (const command of agentCommands) {
      // Aliases match too (typing /cost surfaces /usage); selection inserts the canonical name.
      if (
        !matchesQuery(command.name, command.name, command.description, commandQuery) &&
        !command.aliases?.some((alias) => alias.toLowerCase().includes(commandQuery))
      ) {
        continue;
      }
      commandItems.push({
        command,
        hint: command.description ?? command.argumentHint,
        icon: BookTextIcon,
        id: `command:${command.name}`,
        kind: 'command',
        label: `/${command.name}`,
        source: 'slash',
        value: command.name,
      });
    }
  }
  for (const item of commandItemCandidates) {
    if (commandSource === 'slash' && item.source === 'plus') continue;
    if (matchesQuery(item.label, item.value, item.hint, commandQuery)) commandItems.push(item);
  }

  if (commandSource === 'plus' && modesEnabled) {
    for (const mode of availableModes) {
      if (!matchesQuery(mode.name, mode.modeId, mode.description, commandQuery)) continue;
      commandItems.push({
        active: currentModeId === mode.modeId,
        hint: mode.description,
        icon: MODE_COMMAND_ICONS[mode.modeId] ?? SlidersHorizontalIcon,
        id: `mode:${mode.modeId}`,
        kind: 'mode',
        label: mode.name,
        mode,
        source: 'plus',
        value: mode.modeId,
      });
    }
  }

  return commandItems.length > 0
    ? [{ items: commandItems, label: labels.commands, value: 'commands' }]
    : [];
}

function CommandIcon({ entry }: { entry: ComposerCommandEntry }): React.ReactNode {
  const Icon = entry.icon;
  if (!Icon) return null;
  return (
    <Icon className={entry.kind === 'mention' ? 'size-4 shrink-0' : 'size-4 shrink-0 opacity-80'} />
  );
}

export function ComposerCommandMenu({
  emptyLabel,
  onSelect,
}: {
  emptyLabel: string;
  onSelect: (entry: ComposerCommandEntry) => void;
}): React.ReactNode {
  return (
    <div className="flex max-h-80 min-h-0 flex-col **:data-[slot=scroll-area-viewport]:max-h-80 **:data-[slot=scroll-area-viewport]:data-has-overflow-y:pe-0!">
      <CommandEmpty>{emptyLabel}</CommandEmpty>
      <div className="min-h-0 flex-1">
        <CommandList className="in-data-has-overflow-y:pe-2! not-empty:scroll-py-1 not-empty:p-1 not-empty:pb-2">
          {(group: ComposerCommandGroup) => (
            <CommandGroup key={group.value} items={group.items}>
              <CommandGroupLabel>{group.label}</CommandGroupLabel>
              <CommandCollection>
                {(entry: ComposerCommandEntry) => (
                  <CommandItem
                    key={entry.id}
                    className="gap-2"
                    disabled={entry.disabled}
                    value={entry}
                    onClick={(event) => {
                      event.preventBaseUIHandler();
                      onSelect(entry);
                    }}
                  >
                    <CommandIcon entry={entry} />
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="shrink-0">{entry.label}</span>
                      {entry.hint ? (
                        <span
                          className="min-w-0 truncate text-muted-foreground text-xs"
                          title={entry.hint}
                        >
                          {entry.hint}
                        </span>
                      ) : null}
                    </span>
                    {entry.kind === 'mode' && entry.active ? (
                      <CheckIcon className="ms-auto size-4 shrink-0 opacity-80" />
                    ) : null}
                  </CommandItem>
                )}
              </CommandCollection>
            </CommandGroup>
          )}
        </CommandList>
      </div>
    </div>
  );
}
