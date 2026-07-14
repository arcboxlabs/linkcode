import type {
  AgentCapabilities,
  AgentCommand,
  AgentKind,
  ApprovalPolicyState,
  ContentBlock,
  EffortLevel,
  SessionMode,
} from '@linkcode/schema';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES, textBlock } from '@linkcode/schema';
import { AutocompletePrimitive } from 'coss-ui/components/autocomplete';
import { Badge } from 'coss-ui/components/badge';
import { Command } from 'coss-ui/components/command';
import { Frame, FrameFooter } from 'coss-ui/components/frame';
import { Input } from 'coss-ui/components/input';
import { toastManager } from 'coss-ui/components/toast';
import { noop } from 'foxact/noop';
import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { TerminalIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
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
import { AGENT_EFFORT_OPTIONS } from './agent-efforts';
import { AGENT_MODEL_OPTIONS } from './agent-models';
import type { AgentRuntimeCues } from './agent-onboarding-card';
import type { ComposerAttachment } from './composer-attachments';
import {
  failedComposerAttachment,
  isSupportedImageFile,
  pendingComposerAttachment,
  readImageFileAsComposerAttachment,
} from './composer-attachments';
import type {
  AgentCommandEntry,
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
import { parseComposerDirective } from './composer-directives';
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
  /** Whether the current frontend capability stub allows image attachments. */
  attachmentsSupported?: boolean;
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
  /** The session's slash-command catalog, reflected from `available-commands-update`. Empty or
   * absent means the agent advertised none — the `/` menu then offers no command entries and a
   * typed `/name` submits as plain text. */
  agentCommands?: AgentCommand[] | null;
  /** Stable input features advertised by the live adapter session. */
  agentCapabilities?: AgentCapabilities | null;
  onSend: (content: ContentBlock[]) => void;
  /** Sends a catalog command invocation; absent routes a matched `/name` through `onSend`. */
  onInvokeCommand?: (name: string, args?: string) => void;
  /** Sends a `$`-prefixed shell passthrough when the session advertises it. */
  onRunShellCommand?: (command: string) => void;
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
   * the "Attach" action falls back to the Coss file input. */
  onPickAttachmentFiles?: () => Promise<ComposerAttachment[]>;
}

const EMPTY_MENTION_ITEMS: MentionItem[] = [];
const EMPTY_AGENT_COMMANDS: AgentCommand[] = [];
const WHITESPACE_RE = /\s/;
const LEADING_WHITESPACE_RE = /^\s/;

function attachmentPayloadBytes(attachments: readonly ComposerAttachment[]): number {
  return attachments.reduce(
    (sum, attachment) => (attachment.status === 'failed' ? sum : sum + (attachment.sizeBytes ?? 0)),
    0,
  );
}

export function Composer({
  handleRef,
  agentLabel,
  agentKind,
  attachmentsSupported = false,
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
  agentCommands,
  agentCapabilities,
  onSend,
  onInvokeCommand,
  onRunShellCommand,
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
  const reducedMotion = useReducedMotion() ?? false;
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
  const hasPendingAttachment = attachments.some((attachment) => attachment.status === 'pending');
  const hasReadyAttachment = attachments.some(
    (attachment) => attachment.status === 'ready' && attachment.block !== undefined,
  );

  const catalog = agentCapabilities?.slashCommands
    ? (agentCommands ?? EMPTY_AGENT_COMMANDS)
    : EMPTY_AGENT_COMMANDS;
  const shellEnabled = Boolean(agentCapabilities?.shellCommand && onRunShellCommand && !disabled);
  // The whole draft is one shell command while it starts with `$` — the composer shows the badge
  // and routes the submit; slash/mention menus stay out of the way (a path like /tmp inside the
  // command must not pop the command menu).
  const shellActive = shellEnabled && value.trimStart()[0] === '$';

  const textTrigger = useMemo(() => {
    const trigger = computeTextTrigger(value, caret);
    return trigger && trigger.start !== dismissedStart && !shellActive ? trigger : null;
  }, [caret, dismissedStart, shellActive, value]);
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
        agentCommands: catalog,
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
      catalog,
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
  const frameVisible = commandOpen || contextBar != null;
  const emptyCommandLabel = commandSource === 'mention' ? t('noMentions') : t('noCommands');
  const [exitCommandGroups, setExitCommandGroups] = useState(() => commandGroups);
  const [exitCommandEmptyLabel, setExitCommandEmptyLabel] = useState(emptyCommandLabel);

  // Commit the open catalog before rendering children so every close path can animate that exact view.
  if (commandOpen) {
    if (exitCommandGroups !== commandGroups) setExitCommandGroups(commandGroups);
    if (exitCommandEmptyLabel !== emptyCommandLabel) {
      setExitCommandEmptyLabel(emptyCommandLabel);
    }
  }

  const renderedCommandGroups = commandOpen ? commandGroups : exitCommandGroups;
  const renderedEmptyCommandLabel = commandOpen ? emptyCommandLabel : exitCommandEmptyLabel;

  function updateCaret(nextCaret: number, nextValue = value): void {
    setCaret(nextCaret);
    const trigger = computeTextTrigger(nextValue, nextCaret);
    if (!trigger) setDismissedStart(null);
    // Event-driven query reporting (never an effect watching state): every caret/value
    // change flows through here, so the app's mention source stays in sync with typing.
    onMentionQueryChange?.(trigger?.kind === 'mention' ? trigger.query : null);
  }

  function updateValue(nextValue: string, event: Event): void {
    const control = textControlFromEvent(event);
    const nextCaret = control?.selectionStart ?? nextValue.length;
    const nextTrigger = computeTextTrigger(nextValue, nextCaret);
    setPlusCommandStart((start) =>
      start === null || nextTrigger ? null : movePlusCommandStart(value, nextValue, start),
    );
    setValue(nextValue);
    updateCaret(nextCaret, nextValue);
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
    if (
      (!text && readyAttachments.length === 0) ||
      disabled ||
      sendBlocked ||
      hasPendingAttachment
    ) {
      return;
    }
    const directive = parseComposerDirective(text, { commands: catalog, shellEnabled });
    if (directive.kind === 'command' && onInvokeCommand) {
      onInvokeCommand(directive.name, directive.arguments);
    } else if (directive.kind === 'shell' && onRunShellCommand) {
      onRunShellCommand(directive.command);
    } else {
      const content: ContentBlock[] = [
        ...(text ? [textBlock(text)] : []),
        ...readyAttachments.map((attachment) => attachment.block),
      ];
      onSend(content);
      // Attachments travel only with plain prompts — a command/shell directive can't carry them,
      // so they stay staged in the tray instead of being silently dropped unsent.
      setAttachments([]);
    }
    setValue('');
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
    let total = attachmentPayloadBytes(attachments);
    for (const file of files) {
      const validationError = isSupportedImageFile(file)
        ? file.size > MAX_ATTACHMENT_BYTES
          ? t('attachmentTooLarge')
          : null
        : t('attachmentUnsupportedType');
      if (validationError) {
        const failed = failedComposerAttachment(pendingComposerAttachment(file), validationError);
        setAttachments((prev) => [...prev, failed]);
        toastManager.add({ title: validationError, type: 'error' });
        continue;
      }
      if (total + file.size > MAX_ATTACHMENT_TOTAL_BYTES) {
        toastManager.add({ title: t('attachmentsTotalTooLarge'), type: 'error' });
        continue;
      }
      total += file.size;
      const pending = pendingComposerAttachment(file);
      setAttachments((prev) => [...prev, pending]);
      void readImageFileAsComposerAttachment(file, pending, t('attachmentReadFailed'))
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
    let total = attachmentPayloadBytes(attachments);
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
    insertMentionTrigger(value, textareaRef.current?.selectionStart ?? caret);
  }

  /** Replace the `/query` trigger token with `/name ` so the user can type arguments; Enter then
   * submits it as a command directive (see `submit`). */
  function selectAgentCommand(entry: AgentCommandEntry): void {
    if (textTrigger?.kind !== 'slash') return;
    const rest = value.slice(caret);
    const sep = LEADING_WHITESPACE_RE.test(rest) ? '' : ' ';
    const insert = `/${entry.command.name}`;
    const next = `${value.slice(0, textTrigger.start)}${insert}${sep}${rest}`;
    setPlusCommandStart(null);
    setValueAndCaret(next, textTrigger.start + insert.length + sep.length);
  }

  function selectCommand(entry: ComposerCommandEntry): void {
    if (entry.disabled) return;

    if (entry.kind === 'mention') {
      selectMention(entry);
      return;
    }

    if (entry.kind === 'command') {
      selectAgentCommand(entry);
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

  return (
    <div
      className="relative px-4 pb-4"
      onDragEnter={onAttachmentDragEnter}
      onDragLeave={onAttachmentDragLeave}
      onDragOver={onAttachmentDragOver}
      onDrop={onAttachmentDrop}
    >
      {/* Coss file-input fallback for webview; desktop supplies a native dialog instead. */}
      <Input
        ref={fileInputRef}
        // Keep in sync with SUPPORTED_ATTACHMENT_IMAGE_MIME_TYPES in @linkcode/schema — the lint
        // rule for this attribute requires a static literal, so it can't be derived at render time.
        accept="image/jpeg, image/png, image/gif, image/webp"
        className="hidden"
        multiple
        nativeInput
        type="file"
        unstyled
        onChange={onFileInputChange}
      />
      <div className="mx-auto max-w-3xl">
        <div className="relative isolate">
          <Command
            autoHighlight="always"
            filter={null}
            inline={false}
            items={renderedCommandGroups}
            itemToStringValue={commandEntryToString}
            keepHighlight
            open={commandOpen}
            value={value}
            onOpenChange={(open) => {
              if (!open) closeCommand();
            }}
            onValueChange={(nextValue, details) => updateValue(nextValue, details.event)}
          >
            <Frame
              className={cn(
                'transition-[background-color,padding] motion-reduce:transition-none',
                frameVisible
                  ? 'duration-200 ease-[cubic-bezier(0.2,0,0,1)]'
                  : 'bg-transparent p-0 duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
                isDraggingOver && 'ring-2 ring-ring',
              )}
            >
              <div aria-hidden={!commandOpen} inert={!commandOpen} className="min-h-0">
                <AnimatePresence initial={false}>
                  {commandOpen ? (
                    <motion.div
                      key="composer-command-menu"
                      data-slot="composer-command-menu"
                      className="max-h-80 min-h-0 overflow-hidden"
                      initial={reducedMotion ? false : { height: 0, opacity: 0 }}
                      animate={{
                        height: 'auto',
                        opacity: 1,
                        transition: reducedMotion
                          ? { duration: 0 }
                          : {
                              height: { duration: 0.22, ease: [0.2, 0, 0, 1] },
                              opacity: { duration: 0.18, ease: [0.2, 0, 0, 1] },
                            },
                      }}
                      exit={{
                        height: 0,
                        opacity: 0,
                        transition: reducedMotion
                          ? { duration: 0 }
                          : {
                              height: { duration: 0.3, ease: [0.4, 0, 0.2, 1] },
                              opacity: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
                            },
                      }}
                    >
                      <ComposerCommandMenu
                        emptyLabel={renderedEmptyCommandLabel}
                        onSelect={selectCommand}
                      />
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </div>
              <PromptInput
                onSubmit={submit}
                className={cn(
                  'relative z-10',
                  frameVisible && '*:[[data-slot=input-group]]:rounded-xl',
                )}
              >
                {attachments.length > 0 ? (
                  <Attachments
                    attachments={attachments}
                    className="w-full px-3.5 pt-3"
                    labels={{
                      failed: t('attachmentFailed'),
                      pending: t('attachmentPending'),
                      remove: t('removeAttachment'),
                    }}
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
                    {shellActive ? (
                      <Badge className="gap-1" variant="secondary">
                        <TerminalIcon aria-hidden className="size-3" />
                        {t('shellCommand')}
                      </Badge>
                    ) : null}
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
                        (value.trim().length === 0 && !hasReadyAttachment) ||
                        hasPendingAttachment)
                    }
                    onStop={onStop}
                    status={isRunning ? 'streaming' : 'ready'}
                    className="rounded-full"
                    variant={isRunning ? 'secondary' : 'default'}
                  />
                </PromptInputFooter>
              </PromptInput>
              {contextBar ? <FrameFooter className="p-0">{contextBar}</FrameFooter> : null}
            </Frame>
          </Command>
        </div>
      </div>
    </div>
  );
}
