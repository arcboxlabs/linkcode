import type { AgentKind, ApprovalPolicyState, EffortLevel, SessionMode } from '@linkcode/schema';
import { AutocompletePrimitive } from 'coss-ui/components/autocomplete';
import { Command } from 'coss-ui/components/command';
import { noop } from 'foxact/noop';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '../chat/prompt-input';
import { AGENT_EFFORT_OPTIONS } from './agent-efforts';
import { AGENT_MODEL_OPTIONS } from './agent-models';
import type { AgentRuntimeCues } from './agent-onboarding-card';
import type {
  ComposerCommandEntry,
  ComposerCommandSource,
  MentionCommandEntry,
  MentionItem,
} from './composer-command';
import {
  buildComposerCommandGroups,
  ComposerCommandMenu,
  commandEntryToString,
  computeTextTrigger,
  preventBaseUIHandler,
  textControlFromEvent,
} from './composer-command';
import {
  ApprovalPolicyMenu,
  ComposerPlusMenu,
  ModelSelectorMenu,
  SessionModeChip,
} from './composer-controls';
import { movePlusCommandStart } from './composer-plus-search';
import { DEFAULT_MODE_ID, STUB_SESSION_MODES } from './session-modes';

export type { MentionItem } from './composer-command';

/** Imperative surface for callers outside the composer tree (e.g. artifact
 * click-to-reference); the draft itself stays composer-local state. */
export interface ComposerHandle {
  /** Insert text at the caret (whitespace-separated), focus, and place the caret after it. */
  insertText: (text: string) => void;
}

export interface ComposerProps {
  /** Receives the imperative handle (React 19 ref-as-prop). */
  handleRef?: React.Ref<ComposerHandle>;
  agentLabel?: string;
  /** Which adapter is running the active session; picks the model list to show (if any). */
  agentKind?: AgentKind;
  /** No active session: the composer is inert. */
  disabled: boolean;
  /** Blocks sending only (agent runtime not ready — CODE-112): typing and every menu, including
   * the provider picker needed to switch away, stay usable. */
  sendBlocked?: boolean;
  /** A turn is in flight: show Stop instead of Send. */
  isRunning: boolean;
  /** Entries for the `@` menu (default: none). */
  mentionItems?: MentionItem[];
  /** Active workflow mode id, reflected from the session's `current-mode-update` event. */
  currentModeId: string | null;
  /** Agent-advertised workflow modes (plan / goal / … — see session-modes.ts). Defaults to the
   * stub list until the backend emits the advertised set. */
  availableModes?: SessionMode[];
  /** The agent-advertised approval-policy state (the permission/safety axis), reflected from the
   * session's `approval-policy-update` event. Absent or empty hides the policy menu. */
  approvalPolicy?: ApprovalPolicyState | null;
  onSend: (text: string) => void;
  onStop: () => void;
  /** Sends the workflow-mode switch (`set-mode`); the active mode is reflected from the session's
   * `current-mode-update` event, not locally. */
  onModeChange?: (modeId: string) => Promise<void>;
  /** Sends the approval-policy switch (`set-approval-policy`); like `onModeChange`, the pick is
   * reflected back via `approval-policy-update` — a rejected switch keeps the previous policy. */
  onApprovalPolicyChange?: (policyId: string) => Promise<void>;
  /** Called when the user picks a model from the (adapter-specific) list. The picker only reflects
   * the pick once this resolves — it stays on the previous model if the switch is rejected. */
  onModelChange?: (model: string) => Promise<void>;
  /** Called when the user picks a reasoning-effort level; same confirm-then-reflect contract. */
  onEffortChange?: (effort: EffortLevel) => Promise<void>;
  /** Providers offered for selection (the new-session composer). Absent or empty means the
   * provider is fixed — the trigger then hides the provider glyph and submenu. */
  selectableProviders?: AgentKind[];
  /** Runtime availability badges for the provider submenu (CODE-112). */
  runtimeCues?: AgentRuntimeCues;
  onProviderChange?: (provider: AgentKind) => Promise<void>;
  /** Strip rendered at the bottom of the composer card (e.g. the new-session workspace bar). */
  contextBar?: React.ReactNode;
}

const EMPTY_MENTION_ITEMS: MentionItem[] = [];
const WHITESPACE_RE = /\s/;
const LEADING_WHITESPACE_RE = /^\s/;

export function Composer({
  handleRef,
  agentLabel,
  agentKind,
  disabled,
  sendBlocked = false,
  isRunning,
  mentionItems = EMPTY_MENTION_ITEMS,
  currentModeId,
  availableModes = STUB_SESSION_MODES,
  approvalPolicy,
  onSend,
  onStop,
  onModeChange,
  onApprovalPolicyChange,
  onModelChange,
  onEffortChange,
  selectableProviders,
  runtimeCues,
  onProviderChange,
  contextBar,
}: ComposerProps): React.ReactNode {
  const t = useTranslations('workbench.composer');
  const [value, setValue] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedEffortId, setSelectedEffortId] = useState<EffortLevel | null>(null);
  const [caret, setCaret] = useState(0);
  // The start offset of a trigger the user dismissed with Escape, so the menu stays closed for that token only.
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [plusCommandStart, setPlusCommandStart] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);

  const rawTrigger = computeTextTrigger(value, caret);
  const textTrigger = rawTrigger && rawTrigger.start !== dismissedStart ? rawTrigger : null;
  const commandSource: ComposerCommandSource | null =
    plusCommandStart === null
      ? textTrigger?.kind === 'mention'
        ? 'mention'
        : textTrigger?.kind === 'slash'
          ? 'slash'
          : null
      : 'plus';
  const plusQuery =
    plusCommandStart !== null && caret >= plusCommandStart
      ? value.slice(plusCommandStart, caret).toLowerCase()
      : '';

  // An id the agent advertises on the approval-policy axis is owned there (claude-code's plan is a
  // permission mode, mirroring Claude Desktop's single Mode menu) — drop its stub workflow twin.
  const workflowModes = useMemo(
    () =>
      availableModes.filter(
        (mode) =>
          !approvalPolicy?.availablePolicies.some((policy) => policy.policyId === mode.modeId),
      ),
    [availableModes, approvalPolicy],
  );

  const commandGroups = useMemo(
    () =>
      buildComposerCommandGroups({
        availableModes: workflowModes,
        commandSource,
        currentModeId,
        labels: {
          attach: t('attach'),
          commands: t('commands'),
          mentions: t('mentions'),
        },
        mentionItems,
        modesEnabled: Boolean(onModeChange),
        plusQuery,
        textTrigger,
      }),
    [
      workflowModes,
      commandSource,
      currentModeId,
      mentionItems,
      onModeChange,
      plusQuery,
      t,
      textTrigger,
    ],
  );

  const hasCommandItems = commandGroups.some((group) => group.items.length > 0);
  const commandOpen = !disabled && Boolean(commandSource);

  function updateCaret(nextCaret: number, nextValue = value): void {
    setCaret(nextCaret);
    if (!computeTextTrigger(nextValue, nextCaret)) setDismissedStart(null);
  }

  function updateValue(nextValue: string, event: Event): void {
    setPlusCommandStart((start) =>
      start === null ? null : movePlusCommandStart(value, nextValue, start),
    );
    setValue(nextValue);
    const control = textControlFromEvent(event);
    updateCaret(control?.selectionStart ?? nextValue.length, nextValue);
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
    if (!text || disabled || sendBlocked) return;
    onSend(text);
    setValue('');
    setCaret(0);
    setDismissedStart(null);
    setPlusCommandStart(null);
  }

  function setValueAndCaret(nextValue: string, nextCaret: number): void {
    setValue(nextValue);
    setCaret(nextCaret);
    pendingCaretRef.current = nextCaret;
  }

  function focusTextareaAtCaret(): void {
    pendingCaretRef.current = textareaRef.current?.selectionStart ?? caret;
  }

  function openPlusCommand(): void {
    if (disabled) return;
    setDismissedStart(null);
    setPlusCommandStart(textareaRef.current?.selectionStart ?? caret);
    focusTextareaAtCaret();
  }

  function insertMentionTrigger(nextValue = value, nextCaret = caret): void {
    const before = nextValue.slice(0, nextCaret);
    const insert = `${before.length > 0 && !WHITESPACE_RE.test(before.at(-1)!) ? ' ' : ''}@`;
    const updated = `${before}${insert}${nextValue.slice(nextCaret)}`;
    setPlusCommandStart(null);
    setDismissedStart(null);
    setValueAndCaret(updated, nextCaret + insert.length);
  }

  function selectMention(entry: MentionCommandEntry): void {
    if (textTrigger?.kind !== 'mention') return;
    // Avoid a double space when the trigger token is already followed by whitespace.
    const rest = value.slice(caret);
    const sep = LEADING_WHITESPACE_RE.test(rest) ? '' : ' ';
    const insert = `@${entry.mention.value}`;
    const next = `${value.slice(0, textTrigger.start)}${insert}${sep}${rest}`;
    setPlusCommandStart(null);
    setValueAndCaret(next, textTrigger.start + insert.length + sep.length);
  }

  function selectMentionCommand(): void {
    if (textTrigger?.kind === 'slash') {
      const next = `${value.slice(0, textTrigger.start)}@${value.slice(caret)}`;
      setPlusCommandStart(null);
      setDismissedStart(null);
      setValueAndCaret(next, textTrigger.start + 1);
      return;
    }

    insertMentionTrigger(value, textareaRef.current?.selectionStart ?? caret);
  }

  function selectCommand(entry: ComposerCommandEntry): void {
    if (entry.disabled) return;

    if (entry.kind === 'mention') {
      selectMention(entry);
      return;
    }

    if (entry.kind === 'action') {
      if (entry.id === 'mention-command') selectMentionCommand();
      return;
    }

    toggleMode(entry.mode);
    setPlusCommandStart(null);
    focusTextareaAtCaret();
  }

  function closeCommand(): void {
    setPlusCommandStart(null);
    if (textTrigger) setDismissedStart(textTrigger.start);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Don't treat IME-composition Enter (CJK candidate confirm) as submit/select.
    if (e.nativeEvent.isComposing || e.key === 'Process') return;
    if (commandOpen) {
      if (!hasCommandItems && e.key === 'Enter') e.preventDefault();
      return;
    }
    preventBaseUIHandler(e);
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
  for (const mode of workflowModes) {
    if (mode.modeId === currentModeId) matchedMode = mode;
  }
  const activeMode = matchedMode;

  function toggleMode(mode: SessionMode): void {
    const target = currentModeId === mode.modeId ? DEFAULT_MODE_ID : mode.modeId;
    void onModeChange?.(target).catch(noop);
  }

  // Server-reflected like the workflow mode: the pick only shows once approval-policy-update
  // echoes it back, so a rejected switch simply leaves the previous policy active.
  function selectPolicy(policyId: string): void {
    void onApprovalPolicyChange?.(policyId).catch(noop);
  }

  function insertText(text: string): void {
    const insert = text.trim();
    if (!insert || disabled) return;
    const pos = textareaRef.current?.selectionStart ?? value.length;
    const before = value.slice(0, pos);
    const after = value.slice(pos);
    const lead = before.length > 0 && !WHITESPACE_RE.test(before.at(-1)!) ? ' ' : '';
    const trail = LEADING_WHITESPACE_RE.test(after) ? '' : ' ';
    setValueAndCaret(
      `${before}${lead}${insert}${trail}${after}`,
      pos + lead.length + insert.length + trail.length,
    );
    setDismissedStart(null);
  }

  // No deps: the handle re-binds every render so insertText always sees the current draft.
  useImperativeHandle(handleRef, () => ({ insertText }));

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

  const emptyCommandLabel = commandSource === 'mention' ? t('noMentions') : t('noCommands');

  return (
    <div className="relative px-4 pb-4">
      <div className="mx-auto max-w-3xl">
        <div className="relative isolate">
          <Command
            autoHighlight="always"
            filter={null}
            inline={false}
            items={commandGroups}
            itemToStringValue={commandEntryToString}
            keepHighlight
            open={commandOpen}
            value={value}
            onOpenChange={(open) => {
              if (!open) closeCommand();
            }}
            onValueChange={(nextValue, details) => updateValue(nextValue, details.event)}
          >
            {commandOpen ? (
              <ComposerCommandMenu emptyLabel={emptyCommandLabel} onSelect={selectCommand} />
            ) : null}
            <PromptInput onSubmit={submit} className="relative z-10">
              <AutocompletePrimitive.Input
                render={
                  <PromptInputTextarea
                    ref={textareaRef}
                    disabled={disabled}
                    rows={1}
                    placeholder={
                      disabled
                        ? t('placeholderDisconnected')
                        : `Describe what you want ${placeholderAgent} to do, or @-reference a file / terminal output...`
                    }
                    onClick={(e) =>
                      updateCaret(e.currentTarget.selectionStart, e.currentTarget.value)
                    }
                    onKeyUp={(e) =>
                      updateCaret(e.currentTarget.selectionStart, e.currentTarget.value)
                    }
                    onKeyDown={onKeyDown}
                  />
                }
              />
              <PromptInputFooter>
                <PromptInputTools>
                  <ComposerPlusMenu disabled={disabled} onOpenPlusCommand={openPlusCommand} />
                  {approvalPolicy && approvalPolicy.availablePolicies.length > 0 ? (
                    <ApprovalPolicyMenu
                      agentLabel={placeholderAgent}
                      currentPolicyId={approvalPolicy.currentPolicyId}
                      disabled={disabled}
                      policies={approvalPolicy.availablePolicies}
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
                  runtimeCues={runtimeCues}
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
                  disabled={!isRunning && (disabled || sendBlocked || value.trim().length === 0)}
                  onStop={onStop}
                  status={isRunning ? 'streaming' : 'ready'}
                  className="rounded-full"
                  variant={isRunning ? 'secondary' : 'default'}
                />
              </PromptInputFooter>
              {/* Sibling of the footer addon, which is `order-last` — this must match to stay below it. */}
              {contextBar ? <div className="order-last w-full">{contextBar}</div> : null}
            </PromptInput>
          </Command>
        </div>
      </div>
    </div>
  );
}
