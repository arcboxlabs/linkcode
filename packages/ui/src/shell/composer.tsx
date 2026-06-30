import type { AvailableCommand } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import {
  AtSignIcon,
  ChevronDownIcon,
  PlusIcon,
  ShieldCheckIcon,
  SlashIcon,
  SparklesIcon,
} from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '../chat/prompt-input';
import { cn } from '../lib/cn';

/** A thing the `@` menu can mention. The data source is pluggable; today the apps pass none. */
export interface MentionItem {
  id: string;
  value: string;
  label: string;
  hint?: string;
}

export interface ComposerProps {
  agentLabel?: string;
  /** No active session: the composer is inert. */
  disabled: boolean;
  /** A turn is in flight: show Stop instead of Send. */
  isRunning: boolean;
  /** Slash commands the agent advertises (drives the `/` menu). */
  availableCommands: AvailableCommand[];
  /** Entries for the `@` menu (default: none). */
  mentionItems?: MentionItem[];
  /** Active session mode id, shown as a read-only badge when set. */
  currentModeId: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
}

interface MenuState {
  mode: 'slash' | 'mention';
  query: string;
  start: number;
}

interface MenuEntry {
  id: string;
  insert: string;
  label: string;
  hint?: string;
}

const EMPTY_MENTION_ITEMS: MentionItem[] = [];
const APPROVE_MODES = ['Approve for me', 'Ask each step', 'Read-only'] as const;
const MODEL_OPTIONS = ['claude-sonnet-4.5', 'codex'] as const;

/** Find a `/` or `@` autocomplete trigger at the caret (the maximal non-whitespace run ending there). */
function computeMenu(value: string, caret: number): MenuState | null {
  let start = caret;
  while (start > 0 && !/\s/.test(value[start - 1])) start--;
  const token = value.slice(start, caret);
  if (token.startsWith('/')) return { mode: 'slash', query: token.slice(1), start };
  if (token.startsWith('@')) return { mode: 'mention', query: token.slice(1), start };
  return null;
}

export function Composer({
  agentLabel,
  disabled,
  isRunning,
  availableCommands,
  mentionItems = EMPTY_MENTION_ITEMS,
  currentModeId,
  onSend,
  onStop,
}: ComposerProps): ReactNode {
  const t = useTranslations('workbench.composer');
  const tw = useTranslations('workbench');
  const [value, setValue] = useState('');
  const [approveIndex, setApproveIndex] = useState(0);
  const [modelIndex, setModelIndex] = useState(0);
  const [caret, setCaret] = useState(0);
  // The start offset of a trigger the user dismissed with Escape, so the menu stays closed for that token only.
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [activeIndexState, setActiveIndexState] = useState({ menuKey: '', index: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);

  const raw = computeMenu(value, caret);
  const menu = raw && raw.start !== dismissedStart ? raw : null;

  const entries = useMemo<MenuEntry[]>(() => {
    if (!menu) return [];
    const q = menu.query.toLowerCase();
    if (menu.mode === 'slash') {
      return availableCommands.reduce<MenuEntry[]>((items, c) => {
        if (c.name.toLowerCase().includes(q)) {
          items.push({
            id: c.name,
            insert: `/${c.name}`,
            label: `/${c.name}`,
            hint: c.description,
          });
        }
        return items;
      }, []);
    }
    return mentionItems.reduce<MenuEntry[]>((items, m) => {
      if (m.label.toLowerCase().includes(q) || m.value.toLowerCase().includes(q)) {
        items.push({ id: m.id, insert: `@${m.value}`, label: m.label, hint: m.hint });
      }
      return items;
    }, []);
  }, [menu, availableCommands, mentionItems]);

  const menuKey = menu ? `${menu.mode}:${menu.query}` : '';
  const maxActiveIndex = Math.max(0, entries.length - 1);
  const activeIndex =
    activeIndexState.menuKey === menuKey ? Math.min(activeIndexState.index, maxActiveIndex) : 0;

  function updateActiveIndex(next: number | ((current: number) => number)): void {
    setActiveIndexState((prev) => {
      const current = prev.menuKey === menuKey ? prev.index : 0;
      const index = typeof next === 'function' ? next(current) : next;
      return { menuKey, index: Math.min(Math.max(0, index), maxActiveIndex) };
    });
  }

  function updateCaret(nextCaret: number, nextValue = value): void {
    setCaret(nextCaret);
    if (!computeMenu(nextValue, nextCaret)) setDismissedStart(null);
  }

  useEffect(() => {
    if (pendingCaretRef.current !== null && textareaRef.current) {
      const pos = pendingCaretRef.current;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(pos, pos);
      pendingCaretRef.current = null;
    }
  });

  function submit(): void {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
    setCaret(0);
    setDismissedStart(null);
  }

  function selectEntry(entry: MenuEntry): void {
    if (!menu) return;
    // Avoid a double space when the trigger token is already followed by whitespace.
    const rest = value.slice(caret);
    const sep = /^\s/.test(rest) ? '' : ' ';
    const next = `${value.slice(0, menu.start)}${entry.insert}${sep}${rest}`;
    const pos = menu.start + entry.insert.length + sep.length;
    setValue(next);
    setCaret(pos);
    pendingCaretRef.current = pos;
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    // Don't treat IME-composition Enter (CJK candidate confirm) as submit/select.
    if (e.nativeEvent.isComposing || e.key === 'Process') return;
    // An open menu (even with no matches) owns Enter/Tab/Escape/arrows.
    if (menu) {
      if (e.key === 'ArrowDown' && entries.length > 0) {
        e.preventDefault();
        updateActiveIndex((i) => (i + 1) % entries.length);
        return;
      }
      if (e.key === 'ArrowUp' && entries.length > 0) {
        e.preventDefault();
        updateActiveIndex((i) => (i - 1 + entries.length) % entries.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (entries.length > 0) selectEntry(entries[Math.min(activeIndex, entries.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setDismissedStart(menu.start);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  const placeholderAgent = agentLabel ?? 'agent';

  return (
    <div className="relative px-4 pb-4">
      <div className="mx-auto max-w-3xl">
        <div className="relative">
          {menu && (
            <AutocompleteMenu
              entries={entries}
              activeIndex={activeIndex}
              emptyLabel={menu.mode === 'slash' ? t('noCommands') : t('noMentions')}
              onSelect={selectEntry}
              onHover={updateActiveIndex}
            />
          )}
          <PromptInput onSubmit={submit}>
            <PromptInputTextarea
              ref={textareaRef}
              value={value}
              disabled={disabled}
              rows={1}
              placeholder={
                disabled
                  ? t('placeholderDisconnected')
                  : `Describe what you want ${placeholderAgent} to do, or @-reference a file / terminal output...`
              }
              onChange={(e) => {
                const nextValue = e.target.value;
                setValue(nextValue);
                updateCaret(e.target.selectionStart, nextValue);
              }}
              onClick={(e) => updateCaret(e.currentTarget.selectionStart, e.currentTarget.value)}
              onKeyUp={(e) => updateCaret(e.currentTarget.selectionStart, e.currentTarget.value)}
              onKeyDown={onKeyDown}
            />
            <PromptInputFooter>
              <PromptInputTools>
                <button
                  type="button"
                  aria-label="Attach"
                  title="Attach"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <PlusIcon className="size-4" />
                </button>
                <button
                  type="button"
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-info-foreground hover:bg-info/10"
                  onClick={() => setApproveIndex((index) => (index + 1) % APPROVE_MODES.length)}
                >
                  <ShieldCheckIcon className="size-4" />
                  <span className="font-medium text-sm">{APPROVE_MODES[approveIndex]}</span>
                  <ChevronDownIcon className="size-3.5" />
                </button>
                {currentModeId && (
                  <Badge variant="secondary">
                    {tw('mode.label')}: {currentModeId}
                  </Badge>
                )}
              </PromptInputTools>
              <button
                type="button"
                className="hidden h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm hover:bg-accent sm:flex"
                onClick={() => setModelIndex((index) => (index + 1) % MODEL_OPTIONS.length)}
              >
                <SparklesIcon className="size-3.5 text-muted-foreground" />
                <span className="font-mono">{MODEL_OPTIONS[modelIndex]}</span>
                <span className="text-muted-foreground">Extra high</span>
                <ChevronDownIcon className="size-3.5 text-muted-foreground" />
              </button>
              <span className="hidden items-center gap-1 text-muted-foreground text-xs lg:flex">
                <SlashIcon className="size-3" />
                {t('commands')}
                <AtSignIcon className="ml-1 size-3" />
                {t('mentions')}
              </span>
              <PromptInputSubmit
                aria-label={isRunning ? t('stop') : t('send')}
                disabled={!isRunning && (disabled || value.trim().length === 0)}
                onStop={onStop}
                status={isRunning ? 'streaming' : 'ready'}
                className="rounded-full"
                variant={isRunning ? 'secondary' : 'default'}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

interface AutocompleteMenuProps {
  entries: MenuEntry[];
  activeIndex: number;
  emptyLabel: string;
  onSelect: (entry: MenuEntry) => void;
  onHover: (index: number) => void;
}

/** Command-palette popover floating above the composer. */
function AutocompleteMenu({
  entries,
  activeIndex,
  emptyLabel,
  onSelect,
  onHover,
}: AutocompleteMenuProps): ReactNode {
  return (
    <div className="absolute right-0 bottom-full left-0 mb-2 max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
      {entries.length === 0 ? (
        <div className="px-3 py-2 text-muted-foreground text-sm">{emptyLabel}</div>
      ) : (
        entries.map((entry, i) => (
          <button
            key={entry.id}
            type="button"
            onMouseEnter={() => onHover(i)}
            onClick={() => onSelect(entry)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm',
              i === activeIndex ? 'bg-accent text-accent-foreground' : 'text-foreground',
            )}
          >
            <span className="font-medium">{entry.label}</span>
            {entry.hint && (
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{entry.hint}</span>
            )}
          </button>
        ))
      )}
    </div>
  );
}
