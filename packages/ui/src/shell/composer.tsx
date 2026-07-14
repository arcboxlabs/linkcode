import type {
  AgentKind,
  ApprovalPolicyState,
  ContentBlock,
  EffortLevel,
  SessionMode,
} from '@linkcode/schema';
import { MAX_ATTACHMENT_TOTAL_BYTES, textBlock } from '@linkcode/schema';
import { AutocompletePrimitive } from 'coss-ui/components/autocomplete';
import { Command } from 'coss-ui/components/command';
import { toastManager } from 'coss-ui/components/toast';
import { noop } from 'foxact/noop';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import type { ChatAttachment } from '../chat/attachments';
import { Attachments } from '../chat/attachments';
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '../chat/prompt-input';
import { preventBaseUIHandler } from '../lib/base-ui';
import { cn } from '../lib/cn';
import { AGENT_ATTACHMENT_SUPPORT } from './agent-attachments';
import { AGENT_EFFORT_OPTIONS } from './agent-efforts';
import { AGENT_MODEL_OPTIONS } from './agent-models';
import type { AgentRuntimeCues } from './agent-onboarding-card';
import type { ComposerAttachment } from './composer-attachments';
import {
  failedComposerAttachment,
  pendingComposerAttachment,
  readImageFileAsComposerAttachment,
} from './composer-attachments';
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
  /** Reports the live `@` query (null when no mention trigger is active) so the app can
   * fetch `mentionItems` for it — the data source stays pluggable and app-owned. */
  onMentionQueryChange?: (query: string | null) => void;
  /** Active workflow mode id, reflected from the session's `current-mode-update` event. */
  currentModeId: string | null;
  /** Agent-advertised workflow modes (plan / goal / … — see session-modes.ts). Defaults to the
   * stub list until the backend emits the advertised set. */
  availableModes?: SessionMode[];
  /** The agent-advertised approval-policy state (the permission/safety axis), reflected from the
   * session's `approval-policy-update` event. Absent or empty hides the policy menu. */
  approvalPolicy?: ApprovalPolicyState | null;
  /** The model the session is actually running on, reflected from the session's `model-update`
   * event. `null` until the adapter reports it — the picker then shows a placeholder. */
  currentModel?: string | null;
  /** The reasoning-effort level the session is running at, reflected from `effort-update`; same
   * placeholder rule as `currentModel`. */
  currentEffort?: EffortLevel | null;
  onSend: (content: ContentBlock[]) => void;
  onStop: () => void;
  /** Sends the workflow-mode switch (`set-mode`); the active mode is reflected from the session's
   * `current-mode-update` event, not locally. */
  onModeChange?: (modeId: string) => Promise<void>;
  /** Sends the approval-policy switch (`set-approval-policy`); like `onModeChange`, the pick is
   * reflected back via `approval-policy-update` — a rejected switch keeps the previous policy. */
  onApprovalPolicyChange?: (policyId: string) => Promise<void>;
  /** Sends the model switch (`set-model`); the active model is reflected from `model-update`, not
   * locally — a rejected switch keeps the previous model. */
  onModelChange?: (model: string) => Promise<void>;
  /** Sends the reasoning-effort switch (`set-effort`); reflected from `effort-update`, same contract. */
  onEffortChange?: (effort: EffortLevel) => Promise<void>;
  /** Providers offered for selection (the new-session composer). Absent or empty means the
   * provider is fixed — the trigger then hides the provider glyph and submenu. */
  selectableProviders?: AgentKind[];
  /** Runtime availability badges for the provider submenu (CODE-112). */
  runtimeCues?: AgentRuntimeCues;
  onProviderChange?: (provider: AgentKind) => Promise<void>;
  /** Strip rendered at the bottom of the composer card (e.g. the new-session workspace bar). */
  contextBar?: React.ReactNode;
  /** Opens a native file picker and returns the picked images, ready to stage. Absent (webview):
   * the "Attach" action falls back to a plain `<input type="file">`. */
  onPickAttachmentFiles?: () => Promise<ComposerAttachment[]>;
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
  onMentionQueryChange,
  currentModeId,
  availableModes = STUB_SESSION_MODES,
  approvalPolicy,
  currentModel,
  currentEffort,
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
  onPickAttachmentFiles,
}: ComposerProps): React.ReactNode {
  const t = useTranslations('workbench.composer');
  const [value, setValue] = useState('');
  const [caret, setCaret] = useState(0);
  // The start offset of a trigger the user dismissed with Escape, so the menu stays closed for that token only.
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [plusCommandStart, setPlusCommandStart] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentsSupported = agentKind ? Boolean(AGENT_ATTACHMENT_SUPPORT[agentKind]) : false;

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
        attachEnabled: attachmentsSupported,
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
      attachmentsSupported,
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
    const trigger = computeTextTrigger(nextValue, nextCaret);
    if (!trigger) setDismissedStart(null);
    // Event-driven query reporting (never an effect watching state): every caret/value
    // change flows through here, so the app's mention source stays in sync with typing.
    onMentionQueryChange?.(trigger?.kind === 'mention' ? trigger.query : null);
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
    const readyAttachments = attachments.filter(
      (attachment): attachment is ComposerAttachment & { block: ContentBlock } =>
        attachment.status === 'ready' && attachment.block !== undefined,
    );
    const hasPendingAttachment = attachments.some((attachment) => attachment.status === 'pending');
    if (
      (!text && readyAttachments.length === 0) ||
      disabled ||
      sendBlocked ||
      hasPendingAttachment
    ) {
      return;
    }
    const content: ContentBlock[] = [
      ...(text ? [textBlock(text)] : []),
      ...readyAttachments.map((attachment) => attachment.block),
    ];
    onSend(content);
    setValue('');
    setAttachments([]);
    setCaret(0);
    setDismissedStart(null);
    setPlusCommandStart(null);
    onMentionQueryChange?.(null);
  }

  function ingestFiles(files: File[]): void {
    if (disabled) return;
    if (!attachmentsSupported) {
      if (files.length > 0) {
        toastManager.add({ title: t('attachmentUnsupportedAgent'), type: 'error' });
      }
      return;
    }
    let total = attachments.reduce((sum, attachment) => sum + (attachment.sizeBytes ?? 0), 0);
    for (const file of files) {
      if (total + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
        toastManager.add({ title: t('attachmentsTotalTooLarge'), type: 'error' });
        continue;
      }
      total += file.size;
      const pending = pendingComposerAttachment(file);
      setAttachments((prev) => [...prev, pending]);
      void readImageFileAsComposerAttachment(file, pending, {
        readFailed: t('attachmentReadFailed'),
        tooLarge: t('attachmentTooLarge'),
        unsupportedType: t('attachmentUnsupportedType'),
      })
        .then((ready) => {
          setAttachments((prev) =>
            prev.map((attachment) => (attachment.id === pending.id ? ready : attachment)),
          );
        })
        .catch((err: unknown) => {
          const message = extractErrorMessage(err) ?? t('attachmentReadFailed');
          setAttachments((prev) =>
            prev.map((attachment) =>
              attachment.id === pending.id
                ? failedComposerAttachment(pending, message)
                : attachment,
            ),
          );
          toastManager.add({ title: message, type: 'error' });
        });
    }
  }

  function handleRemoveAttachment(attachment: ChatAttachment): void {
    setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
  }

  function onAttachmentDragEnter(e: React.DragEvent): void {
    if (disabled) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDraggingOver(true);
  }

  function onAttachmentDragOver(e: React.DragEvent): void {
    if (disabled) return;
    e.preventDefault();
  }

  function onAttachmentDragLeave(e: React.DragEvent): void {
    e.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDraggingOver(false);
  }

  function onAttachmentDrop(e: React.DragEvent): void {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDraggingOver(false);
    if (disabled) return;
    ingestFiles(Array.from(e.dataTransfer.files));
  }

  function onTextareaPaste(e: React.ClipboardEvent<HTMLTextAreaElement>): void {
    if (disabled) return;
    const files = Array.from(e.clipboardData.files).filter((file) =>
      file.type.startsWith('image/'),
    );
    if (files.length === 0) return;
    e.preventDefault();
    ingestFiles(files);
  }

  /** Merges already-resolved attachments (from the native picker) into the staged tray, applying
   * the same aggregate cap drag-and-drop enforces — the picker's own per-file checks (type/size)
   * already ran in `attachmentFromReadFile`, so only the running total needs rechecking here. */
  function mergeAttachments(picked: ComposerAttachment[]): void {
    if (picked.length === 0) return;
    let total = attachments.reduce((sum, attachment) => sum + (attachment.sizeBytes ?? 0), 0);
    const merged = picked.map((attachment) => {
      if (attachment.status !== 'ready') {
        if (attachment.errorMessage) {
          toastManager.add({ title: attachment.errorMessage, type: 'error' });
        }
        return attachment;
      }
      if (total + (attachment.sizeBytes ?? 0) > MAX_ATTACHMENT_TOTAL_BYTES) {
        toastManager.add({ title: t('attachmentsTotalTooLarge'), type: 'error' });
        return {
          ...attachment,
          status: 'failed' as const,
          errorMessage: t('attachmentsTotalTooLarge'),
        };
      }
      total += attachment.sizeBytes ?? 0;
      return attachment;
    });
    setAttachments((prev) => [...prev, ...merged]);
  }

  function triggerAttachPicker(): void {
    if (disabled || !attachmentsSupported) return;
    if (onPickAttachmentFiles) {
      void onPickAttachmentFiles()
        .then(mergeAttachments)
        .catch((err: unknown) => {
          toastManager.add({
            title: extractErrorMessage(err) ?? t('attachmentReadFailed'),
            type: 'error',
          });
        });
      return;
    }
    fileInputRef.current?.click();
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    ingestFiles(files);
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
    // A quoted path, replacing the whole @token: every agent understands a quoted relative
    // path in prose (its own fs tools read it), whereas @path is Claude-specific syntax.
    const insert = `"${entry.mention.value.replaceAll('"', String.raw`\"`)}"`;
    const next = `${value.slice(0, textTrigger.start)}${insert}${sep}${rest}`;
    setPlusCommandStart(null);
    setValueAndCaret(next, textTrigger.start + insert.length + sep.length);
    onMentionQueryChange?.(null);
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
      if (entry.id === 'attach') triggerAttachPicker();
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

  // Server-reflected like the workflow mode and approval policy: the pick shows once the session's
  // `model-update` / `effort-update` echoes it back (the adapter emits optimistically on accept, so
  // the round-trip is fast), and a rejected switch simply leaves the previous value — the failure
  // lands in the error banner.
  function selectModel(modelId: string): void {
    void onModelChange?.(modelId).catch(noop);
  }

  function selectEffort(effort: EffortLevel): void {
    void onEffortChange?.(effort).catch(noop);
  }

  const emptyCommandLabel = commandSource === 'mention' ? t('noMentions') : t('noCommands');

  return (
    <div
      className={cn(
        'relative px-4 pb-4',
        isDraggingOver && 'outline-2 outline-primary outline-dashed -outline-offset-2 rounded-2xl',
      )}
      onDragEnter={onAttachmentDragEnter}
      onDragLeave={onAttachmentDragLeave}
      onDragOver={onAttachmentDragOver}
      onDrop={onAttachmentDrop}
    >
      {/* Webview fallback for "Attach" when no onPickAttachmentFiles prop supplies a native
          dialog — desktop always provides one, so this element never activates there. */}
      <input
        ref={fileInputRef}
        // Keep in sync with SUPPORTED_ATTACHMENT_IMAGE_MIME_TYPES in @linkcode/schema — the lint
        // rule for this attribute requires a static literal, so it can't be derived at render time.
        accept="image/jpeg, image/png, image/gif, image/webp"
        className="hidden"
        multiple
        type="file"
        onChange={onFileInputChange}
      />
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
              {attachments.length > 0 ? (
                <Attachments
                  attachments={attachments}
                  className="w-full px-3.5 pt-3"
                  variant="grid"
                  onRemove={handleRemoveAttachment}
                />
              ) : null}
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
                    onPaste={onTextareaPaste}
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
                  selectedEffortId={currentEffort ?? null}
                  selectedModelId={currentModel ?? null}
                  onSelectEffort={selectEffort}
                  onSelectModel={selectModel}
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
                  disabled={
                    !isRunning &&
                    (disabled ||
                      sendBlocked ||
                      (value.trim().length === 0 && attachments.length === 0) ||
                      attachments.some((attachment) => attachment.status === 'pending'))
                  }
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
