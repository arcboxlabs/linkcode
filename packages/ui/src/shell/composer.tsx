import type { AgentKind, EffortLevel, SessionMode } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { noop } from 'foxact/noop';
import { clamp } from 'foxts/clamp';
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
import { AGENT_EFFORT_OPTIONS } from './agent-efforts';
import { AGENT_MODEL_OPTIONS } from './agent-models';
import {
  ApprovalPolicyMenu,
  ComposerPlusMenu,
  ModelSelectorMenu,
  PlanModeChip,
} from './composer-controls';
import { STUB_SESSION_MODES } from './session-modes-stub';

/** The conventional agent mode id treated as the plan toggle (claude-code, codex alike). */
const PLAN_MODE_ID = 'plan';

/** A thing the `@` menu can mention. The data source is pluggable; today the apps pass none. */
export interface MentionItem {
  id: string;
  value: string;
  label: string;
  hint?: string;
}

export interface ComposerProps {
  agentLabel?: string;
  /** Which adapter is running the active session; picks the model list to show (if any). */
  agentKind?: AgentKind;
  /** No active session: the composer is inert. */
  disabled: boolean;
  /** A turn is in flight: show Stop instead of Send. */
  isRunning: boolean;
  /** Entries for the `@` menu (default: none). */
  mentionItems?: MentionItem[];
  /** Active session mode id, from the conversation view-model. */
  currentModeId: string | null;
  /** Agent-advertised session modes. Non-plan modes render as the approval-policy picker and the
   * `plan` mode as the plus-menu toggle. Defaults to the stub list until the backend emits the
   * real SessionModeState (see session-modes-stub.ts). */
  availableModes?: SessionMode[];
  onSend: (text: string) => void;
  onStop: () => void;
  /** Called when the user picks a mode (approval policy or plan toggle). The active mode is
   * reflected from the session's `current-mode-update` event, not locally. */
  onModeChange?: (modeId: string) => Promise<void>;
  /** Called when the user picks a model from the (adapter-specific) list. The picker only reflects
   * the pick once this resolves — it stays on the previous model if the switch is rejected. */
  onModelChange?: (model: string) => Promise<void>;
  /** Called when the user picks a reasoning-effort level; same confirm-then-reflect contract. */
  onEffortChange?: (effort: EffortLevel) => Promise<void>;
  /** Providers offered for selection (planned for the unified new-session composer). Absent or
   * empty means the provider is fixed — the trigger then hides the provider glyph and submenu. */
  selectableProviders?: AgentKind[];
  onProviderChange?: (provider: AgentKind) => Promise<void>;
}

interface MenuState {
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
const WHITESPACE_RE = /\s/;
const LEADING_WHITESPACE_RE = /^\s/;

/** Find an `@` autocomplete trigger at the caret (the maximal non-whitespace run ending there). */
function computeMenu(value: string, caret: number): MenuState | null {
  let start = caret;
  while (start > 0 && !WHITESPACE_RE.test(value[start - 1])) start--;
  const token = value.slice(start, caret);
  if (token[0] === '@') return { query: token.slice(1), start };
  return null;
}

export function Composer({
  agentLabel,
  agentKind,
  disabled,
  isRunning,
  mentionItems = EMPTY_MENTION_ITEMS,
  currentModeId,
  availableModes = STUB_SESSION_MODES,
  onSend,
  onStop,
  onModeChange,
  onModelChange,
  onEffortChange,
  selectableProviders,
  onProviderChange,
}: ComposerProps): React.ReactNode {
  const t = useTranslations('workbench.composer');
  const tw = useTranslations('workbench');
  const [value, setValue] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedEffortId, setSelectedEffortId] = useState<EffortLevel | null>(null);
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
    return mentionItems.reduce<MenuEntry[]>((items, m) => {
      if (m.label.toLowerCase().includes(q) || m.value.toLowerCase().includes(q)) {
        items.push({ id: m.id, insert: `@${m.value}`, label: m.label, hint: m.hint });
      }
      return items;
    }, []);
  }, [menu, mentionItems]);

  const menuKey = menu ? `mention:${menu.query}` : '';
  const maxActiveIndex = Math.max(0, entries.length - 1);
  const activeIndex =
    activeIndexState.menuKey === menuKey ? Math.min(activeIndexState.index, maxActiveIndex) : 0;

  function updateActiveIndex(next: number | ((current: number) => number)): void {
    setActiveIndexState((prev) => {
      const current = prev.menuKey === menuKey ? prev.index : 0;
      const index = typeof next === 'function' ? next(current) : next;
      return { menuKey, index: clamp(index, 0, maxActiveIndex) };
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
    const sep = LEADING_WHITESPACE_RE.test(rest) ? '' : ' ';
    const next = `${value.slice(0, menu.start)}${entry.insert}${sep}${rest}`;
    const pos = menu.start + entry.insert.length + sep.length;
    setValue(next);
    setCaret(pos);
    pendingCaretRef.current = pos;
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
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
  const modelOptions = agentKind ? AGENT_MODEL_OPTIONS[agentKind] : undefined;
  const effortOptions = agentKind ? AGENT_EFFORT_OPTIONS[agentKind] : undefined;

  // One pass: split the advertised modes into the plan toggle and the policy radio list.
  let planMode: SessionMode | null = null;
  const policyModes: SessionMode[] = [];
  for (const mode of availableModes) {
    if (mode.modeId === PLAN_MODE_ID) planMode = mode;
    else policyModes.push(mode);
  }
  const planActive = currentModeId === PLAN_MODE_ID;
  // Remember the last non-plan mode so toggling plan off can restore it (derive-from-props pattern).
  const [lastPolicyId, setLastPolicyId] = useState<string | null>(null);
  if (currentModeId && currentModeId !== PLAN_MODE_ID && currentModeId !== lastPolicyId) {
    setLastPolicyId(currentModeId);
  }
  const activePolicyId = planActive ? lastPolicyId : currentModeId;

  function selectMode(modeId: string): void {
    // The active mode reflects back from the session's current-mode-update event; failures land in
    // the workbench error banner, so a rejected switch simply leaves the previous mode selected.
    void onModeChange?.(modeId).catch(noop);
  }

  function togglePlan(): void {
    if (!planMode) return;
    const target = planActive ? (lastPolicyId ?? policyModes[0]?.modeId) : planMode.modeId;
    if (target) selectMode(target);
  }

  function insertMentionTrigger(): void {
    const pos = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, pos);
    const insert = `${before.length > 0 && !WHITESPACE_RE.test(before.at(-1)!) ? ' ' : ''}@`;
    const next = `${before}${insert}${value.slice(pos)}`;
    const nextCaret = pos + insert.length;
    setValue(next);
    setCaret(nextCaret);
    setDismissedStart(null);
    pendingCaretRef.current = nextCaret;
  }

  async function selectModel(modelId: string): Promise<void> {
    try {
      await onModelChange?.(modelId);
      // Only reflect the pick once the switch is confirmed — otherwise the picker would show a
      // model that isn't actually the one the session is running.
      setSelectedModelId(modelId);
    } catch {
      // The workbench's error banner already reports the failure; nothing else to do here.
    }
  }

  async function selectEffort(effort: EffortLevel): Promise<void> {
    try {
      await onEffortChange?.(effort);
      // Confirm-then-reflect, same as selectModel.
      setSelectedEffortId(effort);
    } catch {
      // The workbench's error banner already reports the failure; nothing else to do here.
    }
  }

  return (
    <div className="relative px-4 pb-4">
      <div className="mx-auto max-w-3xl">
        <div className="relative">
          {menu && (
            <AutocompleteMenu
              entries={entries}
              activeIndex={activeIndex}
              emptyLabel={t('noMentions')}
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
                <ComposerPlusMenu
                  disabled={disabled}
                  finalFocus={textareaRef}
                  planActive={planActive}
                  planMode={planMode}
                  onInsertMention={insertMentionTrigger}
                  onTogglePlan={onModeChange ? togglePlan : undefined}
                />
                {policyModes.length > 0 && onModeChange ? (
                  <ApprovalPolicyMenu
                    activePolicyId={activePolicyId}
                    agentLabel={placeholderAgent}
                    disabled={disabled}
                    policyModes={policyModes}
                    onSelect={selectMode}
                  />
                ) : (
                  currentModeId && (
                    <Badge variant="secondary">
                      {tw('mode.label')}: {currentModeId}
                    </Badge>
                  )
                )}
                {planActive && planMode && onModeChange ? (
                  <PlanModeChip planMode={planMode} onToggle={togglePlan} />
                ) : null}
              </PromptInputTools>
              <ModelSelectorMenu
                disabled={disabled}
                effortOptions={effortOptions}
                modelOptions={modelOptions}
                provider={agentKind}
                selectableProviders={selectableProviders}
                selectedEffortId={selectedEffortId}
                selectedModelId={selectedModelId}
                onSelectEffort={(effort) => {
                  void selectEffort(effort);
                }}
                onSelectModel={(model) => {
                  void selectModel(model);
                }}
                onSelectProvider={
                  onProviderChange
                    ? (provider) => {
                        void onProviderChange(provider).catch(noop);
                      }
                    : undefined
                }
              />
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
}: AutocompleteMenuProps): React.ReactNode {
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
