import type { AgentKind, EffortLevel, SessionMode } from '@linkcode/schema';
import { noop } from 'foxact/noop';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { clamp } from 'foxts/clamp';
import { useMemo, useRef, useState } from 'react';
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
import type { ApprovalPolicyOption } from './approval-policy';
import { STUB_APPROVAL_POLICIES } from './approval-policy';
import {
  ApprovalPolicyMenu,
  ComposerPlusMenu,
  ModelSelectorMenu,
  SessionModeChip,
} from './composer-controls';
import { DEFAULT_MODE_ID, STUB_SESSION_MODES } from './session-modes';

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
  /** Active workflow mode id, reflected from the session's `current-mode-update` event. */
  currentModeId: string | null;
  /** Agent-advertised workflow modes (plan / goal / … — see session-modes.ts). Defaults to the
   * stub list until the backend emits the advertised set. */
  availableModes?: SessionMode[];
  /** Approval policy options — the permission/safety axis (see approval-policy.ts). Defaults to
   * the stub list until agents advertise their own. */
  approvalPolicies?: ApprovalPolicyOption[];
  onSend: (text: string) => void;
  onStop: () => void;
  /** Sends the workflow-mode switch (`set-mode`); the active mode is reflected from the session's
   * `current-mode-update` event, not locally. */
  onModeChange?: (modeId: string) => Promise<void>;
  /** TODO(backend): the policy selection lives in composer-local state with no wire effect until
   * the daemon exposes the approval-policy axis (see approval-policy.ts); this callback then
   * sends the switch and the selection reflects back from session state. */
  onApprovalPolicyChange?: (policyId: string) => Promise<void>;
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
  approvalPolicies = STUB_APPROVAL_POLICIES,
  onSend,
  onStop,
  onModeChange,
  onApprovalPolicyChange,
  onModelChange,
  onEffortChange,
  selectableProviders,
  onProviderChange,
}: ComposerProps): React.ReactNode {
  const t = useTranslations('workbench.composer');
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

  // Layout effect (not a passive one) so the caret lands before paint — a mention insertion
  // must never flash the old caret position for a frame. Deliberately no dependency array: it
  // checks the pendingCaretRef command imperatively on every render rather than reacting to a
  // dependency, so it fires exactly once per render that actually set the ref.
  useLayoutEffect(() => {
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

  // Workflow modes and approval policy are two orthogonal axes (see session-modes.ts and
  // approval-policy.ts). The active mode is server-reflected; failures land in the error banner,
  // so a rejected switch simply leaves the previous mode active.
  let matchedMode: SessionMode | null = null;
  for (const mode of availableModes) {
    if (mode.modeId === currentModeId) matchedMode = mode;
  }
  const activeMode = matchedMode;

  function toggleMode(mode: SessionMode): void {
    const target = currentModeId === mode.modeId ? DEFAULT_MODE_ID : mode.modeId;
    void onModeChange?.(target).catch(noop);
  }

  // TODO(backend): local optimistic state only — replace with server-reflected session state once
  // the daemon exposes the approval-policy axis; a rejected switch should then keep the old pick.
  const [activePolicyId, setActivePolicyId] = useState<string | null>(null);

  function selectPolicy(policyId: string): void {
    setActivePolicyId(policyId);
    void onApprovalPolicyChange?.(policyId).catch(noop);
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
                  currentModeId={currentModeId}
                  disabled={disabled}
                  finalFocus={textareaRef}
                  modes={availableModes}
                  onInsertMention={insertMentionTrigger}
                  onToggleMode={onModeChange ? toggleMode : undefined}
                />
                {approvalPolicies.length > 0 ? (
                  <ApprovalPolicyMenu
                    activePolicyId={activePolicyId}
                    agentLabel={placeholderAgent}
                    disabled={disabled}
                    policies={approvalPolicies}
                    onSelect={selectPolicy}
                  />
                ) : null}
                {activeMode && onModeChange ? (
                  <SessionModeChip
                    disabled={disabled}
                    mode={activeMode}
                    onToggle={() => toggleMode(activeMode)}
                  />
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
