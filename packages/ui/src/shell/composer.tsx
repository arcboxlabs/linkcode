import type {
  AgentCapabilities,
  AgentCommand,
  AgentKind,
  AgentModelOption,
  ApprovalPolicyState,
  ContentBlock,
  EffortLevel,
  SessionMode,
} from '@linkcode/schema';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES, textBlock } from '@linkcode/schema';
import { AutocompletePrimitive } from 'coss-ui/components/autocomplete';
import { Command } from 'coss-ui/components/command';
import { Frame, FrameFooter } from 'coss-ui/components/frame';
import { Input } from 'coss-ui/components/input';
import { toastManager } from 'coss-ui/components/toast';
import { noop } from 'foxact/noop';
import { extractErrorMessage } from 'foxts/extract-error-message';
import type { LexicalEditor } from 'lexical';
import { $getSelection, $setSelection, CLEAR_HISTORY_COMMAND } from 'lexical';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import type { ChatAttachment } from '../chat/attachments';
import { Attachments } from '../chat/attachments';
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
} from '../chat/prompt-input';
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
} from './composer-command';
import {
  ApprovalPolicyMenu,
  ComposerPlusMenu,
  ModelSelectorMenu,
  SessionModeChip,
} from './composer-controls';
import type { ComposerDirectiveIssue } from './composer-editor/directive-hint';
import { ComposerDirectiveHint } from './composer-editor/directive-hint';
import type { ComposerDirectiveControls, DirectiveStatus } from './composer-editor/directive-state';
import {
  commandCatalog,
  commandStatus,
  directiveStateFor,
  shellStatus,
  UNSUPPORTED_COMPOSER_DIRECTIVES,
} from './composer-editor/directive-state';
import type { ComposerDraftSnapshot } from './composer-editor/editor';
import { ComposerEditor, EMPTY_DRAFT_SNAPSHOT } from './composer-editor/editor';
import { $createCommandNode, $createMentionNode } from './composer-editor/nodes';
import type { EditorDirective } from './composer-editor/serialize';
import {
  $clearDraft,
  $convertDirectiveToText,
  $draftDirective,
  $insertSeparatedDraftText,
  $moveDirectiveToStart,
  $removeDirective,
  $replaceTriggerWith,
} from './composer-editor/serialize';
import { $normalizeDirectiveTokens } from './composer-editor/tokenize';
import { movePlusCommandStart } from './composer-plus-search';
import { DEFAULT_MODE_ID, STUB_SESSION_MODES } from './session-modes';

export type { MentionItem } from './composer-command';
export type {
  ComposerDirectiveControls,
  ComposerShellCommandControls,
  ComposerSlashCommandControls,
} from './composer-editor/directive-state';
export { UNSUPPORTED_COMPOSER_DIRECTIVES } from './composer-editor/directive-state';

function liveDirectiveStatus(
  directive: EditorDirective,
  directiveControls: ComposerDirectiveControls,
): DirectiveStatus {
  return directive.kind === 'command'
    ? commandStatus(directive.name, directiveControls.slash)
    : shellStatus(directiveControls.shell);
}

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
  /** Executable directive contract. Loading slash catalogs accept typed commands for host-side
   * validation; ready catalogs are authoritative, including an empty catalog. */
  directiveControls?: ComposerDirectiveControls;
  /** Legacy migration inputs; shells should pass `directiveControls` as one executable contract. */
  agentCommands?: AgentCommand[] | null;
  agentCapabilities?: AgentCapabilities | null;
  deferCommandValidation?: boolean;
  onInvokeCommand?: (name: string, args?: string) => void;
  onRunShellCommand?: (command: string) => void;
  /** The session's adapter-advertised model catalog, reflected from `available-models-update`
   * (install-dependent agents like opencode). Takes precedence over the static per-kind table;
   * empty or absent falls back to that table. */
  agentModels?: AgentModelOption[] | null;
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
   * the "Attach" action falls back to the Coss file input. */
  onPickAttachmentFiles?: () => Promise<ComposerAttachment[]>;
}

const EMPTY_MENTION_ITEMS: MentionItem[] = [];

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
  directiveControls,
  agentCommands,
  agentCapabilities,
  agentModels,
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
  const [snapshot, setSnapshot] = useState(EMPTY_DRAFT_SNAPSHOT);
  // Mirror the *next* draft-change diff against this — state alone can lag when two editor
  // updates commit in the same tick (e.g. a programmatic insert followed by its transform).
  const lastSnapshotRef = useRef(EMPTY_DRAFT_SNAPSHOT);
  // The start offset of a trigger the user dismissed with Escape, so the menu stays closed for that token only.
  const [dismissedStart, setDismissedStart] = useState<number | null>(null);
  const [plusCommandStart, setPlusCommandStart] = useState<number | null>(null);
  const editorRef = useRef<LexicalEditor | null>(null);
  const relayRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasPendingAttachment = attachments.some((attachment) => attachment.status === 'pending');
  const hasReadyAttachment = attachments.some(
    (attachment) => attachment.status === 'ready' && attachment.block !== undefined,
  );

  const legacyDirectiveControls: ComposerDirectiveControls = {
    slash:
      agentCapabilities?.slashCommands && onInvokeCommand
        ? agentCommands == null
          ? { state: 'loading', onInvokeCommand }
          : { state: 'ready', commands: agentCommands, onInvokeCommand }
        : UNSUPPORTED_COMPOSER_DIRECTIVES.slash,
    shell:
      agentCapabilities?.shellCommand && onRunShellCommand
        ? { state: 'ready', onRunShellCommand }
        : UNSUPPORTED_COMPOSER_DIRECTIVES.shell,
  };
  const resolvedDirectiveControls = directiveControls ?? legacyDirectiveControls;

  const catalog = commandCatalog(resolvedDirectiveControls.slash);
  // A draft led by the shell chip is one shell command; slash/mention menus must stay out of
  // the way (a path like /tmp inside the command must not pop the command menu).
  const shellActive = snapshot.directive?.kind === 'shell';
  const blockedDirective: {
    directive: NonNullable<ComposerDraftSnapshot['directive']>;
    issue: ComposerDirectiveIssue;
  } | null = (() => {
    if (snapshot.composition.kind === 'none') return null;
    const directive = snapshot.composition.directive;
    const status = liveDirectiveStatus(directive, resolvedDirectiveControls);
    if (status !== 'supported') return { directive, issue: status };
    return snapshot.composition.kind === 'blocked'
      ? { directive, issue: snapshot.composition.issue }
      : null;
  })();
  const directiveBlocked = blockedDirective !== null;

  const textTrigger = useMemo(() => {
    const trigger = snapshot.trigger;
    return trigger && trigger.flatStart !== dismissedStart && !shellActive ? trigger : null;
  }, [dismissedStart, shellActive, snapshot.trigger]);
  const commandSource: ComposerCommandSource | null =
    plusCommandStart === null
      ? textTrigger?.kind === 'mention'
        ? 'mention'
        : textTrigger?.kind === 'slash'
          ? 'slash'
          : null
      : 'plus';
  const plusQuery =
    plusCommandStart !== null &&
    snapshot.caretOffset !== null &&
    snapshot.caretOffset >= plusCommandStart
      ? snapshot.text.slice(plusCommandStart, snapshot.caretOffset).toLowerCase()
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
  const commandOpen =
    !disabled &&
    Boolean(commandSource) &&
    (resolvedDirectiveControls.slash.state !== 'loading' || commandSource !== 'slash');
  const frameVisible = commandOpen || blockedDirective !== null || contextBar != null;
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

  // Event-driven mirroring (never an effect watching state): every committed editor update flows
  // through here, so trigger/plus/mention state stays in sync with typing.
  function handleDraftChange(next: ComposerDraftSnapshot): void {
    const prev = lastSnapshotRef.current;
    lastSnapshotRef.current = next;
    setSnapshot(next);
    setPlusCommandStart((start) =>
      start === null || next.trigger ? null : movePlusCommandStart(prev.text, next.text, start),
    );
    if (!next.trigger) setDismissedStart(null);
    onMentionQueryChange?.(next.trigger?.kind === 'mention' ? next.trigger.query : null);
  }

  function resetDraftBookkeeping(): void {
    setDismissedStart(null);
    setPlusCommandStart(null);
    onMentionQueryChange?.(null);
  }

  function submit(): void {
    const editor = editorRef.current;
    if (!editor || disabled || sendBlocked || hasPendingAttachment) return;
    const readyAttachments = attachments.filter(
      (attachment): attachment is ComposerAttachment & { block: ContentBlock } =>
        attachment.status === 'ready' && attachment.block !== undefined,
    );
    const store = directiveStateFor(editor);
    // Materialize a boundary-less leading `/name` so Enter right after typing the name still
    // routes through the directive path (and its validity gate) instead of slipping out as text.
    editor.update(() => $normalizeDirectiveTokens(store.getState(), { force: true }), {
      discrete: true,
    });
    const directive = editor.read(() =>
      $draftDirective({ directiveControls: resolvedDirectiveControls }),
    );
    switch (directive.kind) {
      case 'command': {
        // Unknown/unsupported chips visibly error and block here — never silently model chat.
        if (
          directive.status !== 'supported' ||
          resolvedDirectiveControls.slash.state === 'unsupported'
        ) {
          return;
        }
        resolvedDirectiveControls.slash.onInvokeCommand(
          directive.name,
          directive.args || undefined,
        );
        break;
      }
      case 'shell': {
        if (
          directive.status !== 'supported' ||
          !directive.command ||
          resolvedDirectiveControls.shell.state === 'unsupported'
        ) {
          return;
        }
        resolvedDirectiveControls.shell.onRunShellCommand(directive.command);
        break;
      }
      case 'invalid': {
        return;
      }
      case 'text': {
        if (!directive.text && readyAttachments.length === 0) return;
        const content: ContentBlock[] = [
          ...(directive.text ? [textBlock(directive.text)] : []),
          ...readyAttachments.map((attachment) => attachment.block),
        ];
        onSend(content);
        // Attachments travel only with plain prompts — a command/shell directive can't carry them,
        // so they stay staged in the tray instead of being silently dropped unsent.
        setAttachments([]);
        break;
      }
      default: {
        return directive satisfies never;
      }
    }
    editor.update(() => $clearDraft(), { discrete: true });
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    store.setState({ suppressed: new Set() });
    resetDraftBookkeeping();
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

  /** Merges picker-resolved attachments into the tray under the same aggregate cap drag-and-drop
   * enforces; per-file checks already ran in `attachmentFromReadFile`, so only the total recheck. */
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

  /** Run an editor mutation and restore focus while preserving Lexical's selection. */
  function withEditor(mutate: (editor: LexicalEditor) => void): void {
    const editor = editorRef.current;
    if (!editor) return;
    // A contenteditable can lose its DOM selection between an external click and this update.
    // Preserve Lexical's committed selection so artifact/plus-menu insertion still replaces the
    // range the user selected; a newer live selection always wins.
    const retainedSelection = editor.getEditorState().read(() => $getSelection()?.clone() ?? null);
    editor.update(
      () => {
        if ($getSelection() === null && retainedSelection !== null) {
          $setSelection(retainedSelection);
        }
        mutate(editor);
      },
      { discrete: true },
    );
    editor.focus();
  }

  function openPlusCommand(): void {
    if (disabled) return;
    setDismissedStart(null);
    setPlusCommandStart(lastSnapshotRef.current.caretOffset ?? lastSnapshotRef.current.text.length);
    editorRef.current?.focus();
  }

  function insertTextTrigger(trigger: '@' | '/'): void {
    setPlusCommandStart(null);
    setDismissedStart(null);
    withEditor(() => $insertSeparatedDraftText(trigger, false));
  }

  function selectMention(entry: MentionCommandEntry): void {
    if (textTrigger?.kind !== 'mention') return;
    const trigger = textTrigger;
    setPlusCommandStart(null);
    // A mention chip replacing the whole @token; it serializes as a quoted relative path —
    // every agent understands that in prose, whereas @path is Claude-specific syntax.
    withEditor(() => $replaceTriggerWith(trigger, $createMentionNode(entry.mention.value)));
    onMentionQueryChange?.(null);
  }

  function selectMentionCommand(): void {
    insertTextTrigger('@');
    onMentionQueryChange?.('');
  }

  function selectSlashCommand(): void {
    insertTextTrigger('/');
  }

  /** Replace the `/query` trigger token with the command chip so the user can type arguments;
   * Enter then submits it as a command directive (see `submit`). */
  function selectAgentCommand(entry: AgentCommandEntry): void {
    if (textTrigger?.kind !== 'slash') return;
    const trigger = textTrigger;
    setPlusCommandStart(null);
    withEditor(() => $replaceTriggerWith(trigger, $createCommandNode(entry.command.name)));
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
      if (entry.id === 'slash-command') selectSlashCommand();
      if (entry.id === 'attach') triggerAttachPicker();
      return;
    }

    toggleMode(entry.mode);
    setPlusCommandStart(null);
    editorRef.current?.focus();
  }

  function closeCommand(): void {
    setPlusCommandStart(null);
    if (textTrigger) setDismissedStart(textTrigger.flatStart);
    if (textTrigger?.kind === 'mention') onMentionQueryChange?.(null);
  }

  // Persistent footer twins of the chip menu's recovery actions.
  function convertBlockedDirectiveToText(): void {
    if (disabled) return;
    const key = blockedDirective?.directive.nodeKey;
    if (!key) return;
    withEditor((editor) => {
      const suppressedNodeKey = $convertDirectiveToText(key);
      if (suppressedNodeKey) {
        directiveStateFor(editor).setState((state) => ({
          suppressed: new Set(state.suppressed).add(suppressedNodeKey),
        }));
      }
    });
  }

  function removeBlockedDirective(): void {
    if (disabled) return;
    const key = blockedDirective?.directive.nodeKey;
    if (!key) return;
    withEditor(() => {
      $removeDirective(key);
    });
  }

  function moveBlockedDirectiveToStart(): void {
    if (disabled) return;
    const key = blockedDirective?.directive.nodeKey;
    if (!key) return;
    withEditor(() => $moveDirectiveToStart(key));
  }

  function focusEditorFromFooter(e: React.MouseEvent<HTMLDivElement>): void {
    const target = e.target;
    if (
      target instanceof Element &&
      target.closest(
        "button, a, input, select, textarea, [role='button'], [role='combobox'], [role='listbox'], [data-slot='select-trigger']",
      )
    ) {
      return;
    }
    e.preventDefault();
    editorRef.current?.focus();
  }

  const placeholderAgent = agentLabel ?? 'agent';
  // The adapter-advertised catalog wins over the static table: an install-dependent agent
  // (opencode) knows its own reachable models; the table only covers curated vendor lists.
  const modelOptions =
    agentModels && agentModels.length > 0
      ? agentModels
      : agentKind
        ? AGENT_MODEL_OPTIONS[agentKind]
        : undefined;
  const effortOptions = agentKind ? AGENT_EFFORT_OPTIONS[agentKind] : undefined;

  // Workflow mode and approval policy are orthogonal axes (see session-modes.ts, approval-policy.ts).
  // The active mode is server-reflected; a rejected switch (error banner) leaves the previous active.
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
    withEditor(() => $insertSeparatedDraftText(insert, true));
    setDismissedStart(null);
  }

  // No deps: the handle re-binds every render so insertText always sees the current draft.
  useImperativeHandle(handleRef, () => ({ insertText }));

  // Server-reflected like mode/policy: the pick shows once `model-update` / `effort-update` echoes
  // it back; a rejected switch leaves the previous value and the failure lands in the error banner.
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
      <div className="@container/composer mx-auto max-w-3xl">
        <div className="relative isolate">
          <Command
            autoHighlight="always"
            filter={null}
            inline={false}
            items={renderedCommandGroups}
            itemToStringValue={commandEntryToString}
            keepHighlight
            open={commandOpen}
            onOpenChange={(open) => {
              if (!open) closeCommand();
            }}
          >
            {/* Hidden relay: base-ui's list navigation lives on its Input part, which needs real
             * input DOM APIs a contenteditable lacks (e.g. setSelectionRange). The editor forwards
             * ArrowUp/Down/Enter here while the menu is open; the root's `virtual` focus model
             * navigates and Enter-clicks the highlighted item without this input ever focusing. */}
            <AutocompletePrimitive.Input
              aria-hidden
              render={<input ref={relayRef} className="sr-only" tabIndex={-1} />}
            />
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
                <ComposerEditor
                  className="max-h-48 min-h-20.5 overflow-y-auto whitespace-pre-wrap break-words px-3.5 pt-3 pb-1.5 max-sm:min-h-23.5"
                  disabled={disabled}
                  directiveControls={resolvedDirectiveControls}
                  editorRef={editorRef}
                  menuHasItems={hasCommandItems}
                  menuOpen={commandOpen}
                  placeholder={
                    disabled
                      ? t('placeholderDisconnected')
                      : t('placeholder', { agent: placeholderAgent })
                  }
                  relayRef={relayRef}
                  onDraftChange={handleDraftChange}
                  onPasteFiles={ingestFiles}
                  onSubmit={submit}
                />
                <PromptInputFooter onMouseDown={focusEditorFromFooter}>
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
                        directiveBlocked ||
                        (snapshot.text.trim().length === 0 && !hasReadyAttachment) ||
                        hasPendingAttachment)
                    }
                    onStop={onStop}
                    status={isRunning ? 'streaming' : 'ready'}
                    className="rounded-full"
                    variant={isRunning ? 'secondary' : 'default'}
                  />
                </PromptInputFooter>
              </PromptInput>
              <FrameFooter className="p-0">
                <div aria-hidden={!blockedDirective} inert={!blockedDirective} className="min-h-0">
                  <AnimatePresence initial={false}>
                    {blockedDirective ? (
                      <motion.div
                        key="composer-directive-hint"
                        className="min-h-0 overflow-hidden"
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
                        <ComposerDirectiveHint
                          directive={blockedDirective.directive}
                          disabled={disabled}
                          issue={blockedDirective.issue}
                          onConvertToText={convertBlockedDirectiveToText}
                          onMoveToStart={
                            blockedDirective.issue === 'misplaced'
                              ? moveBlockedDirectiveToStart
                              : undefined
                          }
                          onRemove={removeBlockedDirective}
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
                {contextBar}
              </FrameFooter>
            </Frame>
          </Command>
        </div>
      </div>
    </div>
  );
}
