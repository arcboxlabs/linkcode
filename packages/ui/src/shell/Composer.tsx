import type { AvailableCommand } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Textarea } from 'coss-ui/components/textarea';
import { ArrowUpIcon, AtSignIcon, SlashIcon, SquareIcon } from 'lucide-react';
import { type KeyboardEvent, type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';

/** A thing the `@` menu can mention. The data source is pluggable; today the apps pass none. */
export interface MentionItem {
  id: string;
  value: string;
  label: string;
  hint?: string;
}

export interface ComposerProps {
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
  disabled,
  isRunning,
  availableCommands,
  mentionItems = [],
  currentModeId,
  onSend,
  onStop,
}: ComposerProps): ReactElement {
  const t = useTranslations('workbench.composer');
  const tw = useTranslations('workbench');
  const [value, setValue] = useState('');
  const [caret, setCaret] = useState(0);
  // The start offset of a trigger the user dismissed with Escape, so the menu stays closed for that token only.
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);

  const raw = computeMenu(value, caret);
  const menu = raw && raw.start !== dismissedStart ? raw : null;
  const rawStart = raw ? raw.start : null;

  const entries = useMemo<MenuEntry[]>(() => {
    if (!menu) return [];
    const q = menu.query.toLowerCase();
    if (menu.mode === 'slash') {
      return availableCommands
        .filter((c) => c.name.toLowerCase().includes(q))
        .map((c) => ({
          id: c.name,
          insert: `/${c.name}`,
          label: `/${c.name}`,
          hint: c.description,
        }));
    }
    return mentionItems
      .filter((m) => m.label.toLowerCase().includes(q) || m.value.toLowerCase().includes(q))
      .map((m) => ({ id: m.id, insert: `@${m.value}`, label: m.label, hint: m.hint }));
  }, [menu, availableCommands, mentionItems]);

  const menuKey = menu ? `${menu.mode}:${menu.query}` : '';
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset highlight whenever the menu query changes
  useEffect(() => {
    setActiveIndex(0);
  }, [menuKey]);

  // Keep the highlight in range when the entry list shrinks (e.g. availableCommands updates from the wire).
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, entries.length - 1)));
  }, [entries.length]);

  // Clear an Escape-dismissal once the caret leaves the trigger token, so the next trigger opens normally.
  useEffect(() => {
    if (rawStart === null) setDismissedStart(null);
  }, [rawStart]);

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
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // An open menu (even with no matches) owns Enter/Tab/Escape/arrows.
    if (menu) {
      if (e.key === 'ArrowDown' && entries.length > 0) {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % entries.length);
        return;
      }
      if (e.key === 'ArrowUp' && entries.length > 0) {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + entries.length) % entries.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const entry = entries[Math.min(activeIndex, entries.length - 1)];
        if (entry) selectEntry(entry);
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

  return (
    <div className="relative px-4 pb-4">
      <div className="mx-auto max-w-[840px]">
        <div className="relative rounded-2xl border border-input bg-card shadow-xs focus-within:border-ring">
          {menu && (
            <AutocompleteMenu
              mode={menu.mode}
              entries={entries}
              activeIndex={activeIndex}
              emptyLabel={menu.mode === 'slash' ? t('noCommands') : t('noMentions')}
              onSelect={selectEntry}
              onHover={setActiveIndex}
            />
          )}
          <Textarea
            ref={textareaRef}
            value={value}
            disabled={disabled}
            rows={1}
            placeholder={disabled ? t('placeholderDisconnected') : t('placeholder')}
            onChange={(e) => {
              setValue(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
            }}
            onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyUp={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={onKeyDown}
            className="max-h-48 px-3.5 pt-3 pb-1.5"
          />
          <div className="flex items-center gap-2 px-3 pb-2.5">
            {currentModeId && (
              <Badge variant="secondary">
                {tw('mode.label')}: {currentModeId}
              </Badge>
            )}
            <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
              <SlashIcon className="size-3" />
              {t('commands')}
              <AtSignIcon className="ml-1 size-3" />
              {t('mentions')}
            </span>
            {isRunning ? (
              <Button size="icon-sm" variant="secondary" aria-label={t('stop')} onClick={onStop}>
                <SquareIcon />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                aria-label={t('send')}
                disabled={disabled || value.trim().length === 0}
                onClick={submit}
              >
                <ArrowUpIcon />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface AutocompleteMenuProps {
  mode: 'slash' | 'mention';
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
}: AutocompleteMenuProps): ReactElement {
  return (
    <div className="absolute right-0 bottom-full left-0 mb-2 max-h-64 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-md">
      {entries.length === 0 ? (
        <div className="px-3 py-2 text-[13px] text-muted-foreground">{emptyLabel}</div>
      ) : (
        entries.map((entry, i) => (
          <button
            key={entry.id}
            type="button"
            onMouseEnter={() => onHover(i)}
            onClick={() => onSelect(entry)}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[13px]',
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
