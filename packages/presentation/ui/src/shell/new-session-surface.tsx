import type {
  AgentInput,
  AgentKind,
  AgentStartCatalog,
  ContentBlock,
  EffortLevel,
  SessionModeId,
  WorkspaceId,
  WorkspaceRecord,
} from '@linkcode/schema';
import { AGENT_INPUT_CAPABILITIES } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from 'coss-ui/components/menu';
import { noop } from 'foxact/noop';
import { extractErrorMessage } from 'foxts/extract-error-message';
import {
  ChevronDownIcon,
  FolderIcon,
  FolderPlusIcon,
  GitBranchIcon,
  LaptopMinimalIcon,
  MessagesSquareIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { AGENT_LABELS } from '../chat/agent-icon';
import { cn } from '../lib/cn';
import { repositoryLabel } from '../repository-label';
import { AGENT_DEFAULT_MODELS } from './agent-models';
import type { AgentRuntimeCues } from './agent-onboarding-card';
import { AgentOnboardingCard } from './agent-onboarding-card';
import type { ComposerDirectiveControls, MentionItem } from './composer';
import { Composer } from './composer';
import type { ComposerAttachment } from './composer-attachments';
import { DEFAULT_MODE_ID } from './session-modes';

export interface NewSessionDraft {
  /** Resolved by the workbench (explicit pick → last used → chat → first project); null = none available. */
  initialWorkspaceId: WorkspaceId | null;
  initialProvider: AgentKind;
}

export interface NewSessionSubmission {
  kind: AgentKind;
  cwd: string;
  /** The picked workspace backing `cwd` — lets the caller persist it as the next draft's default. */
  workspaceId: WorkspaceId;
  /** Null explicitly returns this provider to its configured/default model. */
  model?: string | null;
  /** Null explicitly returns this provider to its default effort. */
  effort?: EffortLevel | null;
  /** Rides only when the pick diverges from the catalog's default tier. */
  approvalPolicyId?: string;
  modeId?: SessionModeId;
  input: Extract<AgentInput, { type: 'command' | 'prompt' | 'shell-command' }>;
}

export type AttachmentSupportByAgent = Readonly<Partial<Record<AgentKind, true>>>;

/** Pre-session picker data per agent kind, fetched by the workbench over `agent.catalog`. */
export type AgentStartCatalogs = Readonly<Partial<Record<AgentKind, AgentStartCatalog>>>;

export interface NewSessionSurfaceProps {
  draft: NewSessionDraft;
  /** Project workspaces offered by the picker; the chat workspace arrives separately. */
  workspaces: WorkspaceRecord[];
  chatWorkspace: WorkspaceRecord | null;
  className?: string;
  topContent?: React.ReactNode;
  /** Runtime availability per agent (CODE-112): a cue renders the onboarding card for the picked
   * provider and blocks sending until the runtime is ready; badges ride the provider submenu. */
  runtimeCues?: AgentRuntimeCues;
  /** Frontend capability stub used until attachment support is advertised by sessions. */
  attachmentSupport?: AttachmentSupportByAgent;
  /** Pre-session model/policy catalogs; a kind without an entry falls back to the static model
   * table and hides the policy picker (exactly the live composer's fallback behavior). */
  agentCatalogs?: AgentStartCatalogs;
  /** Effective user-configured model defaults. `null` means they are still loading; when omitted,
   * built-in provider defaults fill missing kinds for standalone consumers. */
  defaultModels?: Readonly<Partial<Record<AgentKind, string>>> | null;
  /** Last accepted model per provider. Unlike configured defaults, this is an explicit override. */
  preferredModels?: Readonly<Partial<Record<AgentKind, string>>>;
  /** Last accepted effort per provider. Missing kinds retain the provider default. */
  preferredEfforts?: Readonly<Partial<Record<AgentKind, EffortLevel>>>;
  /** Ranked files for the active draft workspace's `@` query. */
  mentionItems: MentionItem[];
  /** Queries files in the draft's currently selected workspace. */
  onMentionQueryChange: (cwd: string | undefined, query: string | null) => void;
  /** Triggers (or retries) the managed download for an agent whose CLI is missing. */
  onDownloadAgent?: (kind: AgentKind) => void;
  /** Accepts an out-of-range detected version — the workbench remembers the (agent, version) pick. */
  onContinueUnverified?: (kind: AgentKind) => void;
  /** Starts (or retries) the interactive login for a signed-out agent. */
  onLoginAgent?: (kind: AgentKind) => void;
  /** Submits the authorization code pasted from the browser during a login. */
  onSubmitLoginCode?: (kind: AgentKind, code: string) => void;
  /** Aborts an in-flight login. */
  onCancelLogin?: (kind: AgentKind) => void;
  /** Starts the session and sends the prompt. A rejection keeps the page up — the caller's error
   * banner reports the failure, same contract as the conversation composer. */
  onSubmit: (submission: NewSessionSubmission) => Promise<void>;
  /** Opens the native directory picker; desktop only — omit to hide "Choose directory…". */
  onPickDirectory?: () => Promise<string | null>;
  onRegisterWorkspace: (cwd: string) => Promise<WorkspaceRecord>;
  /** Opens a native file picker and returns the picked images, ready to stage. Desktop-only —
   * absent on webview, where the composer's "Attach" action falls back to the Coss file input. */
  onPickAttachmentFiles?: () => Promise<ComposerAttachment[]>;
}

const SELECTABLE_PROVIDERS = Object.keys(AGENT_LABELS) as AgentKind[];

/** Unified new-session page: heading + shared `Composer` + workspace context bar. Model, effort,
 * approval-policy, and workflow-mode picks ride into the submission; the session reflects them
 * from then on. */
export function NewSessionSurface({
  draft,
  workspaces,
  chatWorkspace,
  className,
  topContent,
  runtimeCues,
  attachmentSupport,
  agentCatalogs,
  defaultModels,
  preferredModels,
  preferredEfforts,
  mentionItems,
  onMentionQueryChange,
  onDownloadAgent,
  onContinueUnverified,
  onLoginAgent,
  onSubmitLoginCode,
  onCancelLogin,
  onSubmit,
  onPickDirectory,
  onRegisterWorkspace,
  onPickAttachmentFiles,
}: NewSessionSurfaceProps): React.ReactNode {
  const t = useTranslations('workbench.newSession');
  const [provider, setProvider] = useState(draft.initialProvider);
  const [workspaceId, setWorkspaceId] = useState(draft.initialWorkspaceId);
  const [selectedModels, setSelectedModels] = useState<Partial<Record<AgentKind, string | null>>>(
    {},
  );
  const [selectedEfforts, setSelectedEfforts] = useState<
    Partial<Record<AgentKind, EffortLevel | null>>
  >({});
  const [policyId, setPolicyId] = useState<string | null>(null);
  const [modeId, setModeId] = useState<string>(DEFAULT_MODE_ID);
  const [pending, setPending] = useState(false);

  const selectableWorkspaces = chatWorkspace ? [chatWorkspace, ...workspaces] : workspaces;
  const selected =
    selectableWorkspaces.find((workspace) => workspace.workspaceId === workspaceId) ?? null;
  const isChatSelected = selected != null && selected === chatWorkspace;
  const localModel = selectedModels[provider];
  const selectedModel =
    localModel === undefined ? (preferredModels?.[provider] ?? null) : localModel;
  const displayedModel =
    selectedModel ??
    (defaultModels === null
      ? null
      : (defaultModels?.[provider] ?? AGENT_DEFAULT_MODELS[provider] ?? null));
  const localEffort = selectedEfforts[provider];
  const effort = localEffort === undefined ? (preferredEfforts?.[provider] ?? null) : localEffort;

  // Pre-session data for the picked provider. Model/effort picks feed the Composer's normal
  // fallback chain (dynamic catalog → static table); policies have no static fallback, so the
  // picker only renders for kinds whose catalog carries tiers.
  const catalog = agentCatalogs?.[provider];
  const catalogModels = catalog !== undefined && catalog.models.length > 0 ? catalog.models : null;
  const defaultPolicyId =
    catalog === undefined ? undefined : (catalog.defaultPolicyId ?? catalog.policies[0]?.policyId);
  const currentPolicyId =
    policyId !== null && catalog?.policies.some((p) => p.policyId === policyId)
      ? policyId
      : defaultPolicyId;
  const approvalPolicy =
    catalog !== undefined && catalog.policies.length > 0 && currentPolicyId !== undefined
      ? { availablePolicies: catalog.policies, currentPolicyId }
      : undefined;

  async function submit(input: NewSessionSubmission['input']): Promise<void> {
    if (!selected) throw new Error('Cannot start a session without a workspace');
    setPending(true);
    try {
      await onSubmit({
        kind: provider,
        cwd: selected.cwd,
        workspaceId: selected.workspaceId,
        model: localModel === null ? null : (selectedModel ?? undefined),
        ...(localEffort === null ? { effort: null } : effort !== null && { effort }),
        // The tier rides only when the user picked one that diverges from the catalog default —
        // the adapter starts on the default anyway.
        ...(policyId !== null &&
          currentPolicyId !== undefined &&
          currentPolicyId !== defaultPolicyId && { approvalPolicyId: currentPolicyId }),
        modeId: modeId === DEFAULT_MODE_ID ? undefined : modeId,
        input,
      });
    } finally {
      setPending(false);
    }
  }

  function handleSend(content: ContentBlock[]): Promise<void> {
    return submit({ type: 'prompt', content });
  }

  function handleInvokeCommand(name: string, args?: string): Promise<void> {
    return submit({ type: 'command', name, arguments: args });
  }

  function handleRunShellCommand(command: string): Promise<void> {
    return submit({ type: 'shell-command', command });
  }

  function handleProviderChange(nextProvider: AgentKind): Promise<void> {
    setProvider(nextProvider);
    // Policy tiers are provider-scoped with no per-kind memory: a stale pick must not leak
    // across a provider switch (model/effort keep their per-kind stickiness above).
    setPolicyId(null);
    return Promise.resolve();
  }

  function handleModelChange(nextModel: string): Promise<void> {
    setSelectedModels((current) => ({ ...current, [provider]: nextModel }));
    return Promise.resolve();
  }

  function handleEffortChange(nextEffort: EffortLevel): Promise<void> {
    setSelectedEfforts((current) => ({ ...current, [provider]: nextEffort }));
    return Promise.resolve();
  }

  function handlePolicyChange(nextPolicyId: string): Promise<void> {
    setPolicyId(nextPolicyId);
    return Promise.resolve();
  }

  function handleResetModel(): void {
    setSelectedModels((current) => ({ ...current, [provider]: null }));
  }

  function handleResetEffort(): void {
    setSelectedEfforts((current) => ({ ...current, [provider]: null }));
  }

  function handleModeChange(nextModeId: string): Promise<void> {
    setModeId(nextModeId);
    return Promise.resolve();
  }

  const heading =
    selected && !isChatSelected
      ? t('headingIn', { name: selected.name ?? repositoryLabel(selected.cwd) })
      : t('heading');
  const cue = runtimeCues?.[provider];
  const capabilities = AGENT_INPUT_CAPABILITIES[provider];
  const directiveControls: ComposerDirectiveControls = {
    slash: capabilities.slashCommands
      ? { state: 'loading', onInvokeCommand: handleInvokeCommand }
      : { state: 'unsupported' },
    shell: capabilities.shellCommand
      ? { state: 'ready', onRunShellCommand: handleRunShellCommand }
      : { state: 'unsupported' },
  };

  function handleWorkspaceChange(nextWorkspaceId: WorkspaceId): void {
    onMentionQueryChange(undefined, null);
    setWorkspaceId(nextWorkspaceId);
  }

  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col bg-background', className)}>
      {topContent}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col justify-center py-8">
          <h1 className="px-4 pb-8 text-center font-semibold text-2xl text-foreground">
            {heading}
          </h1>
          {cue && (
            <div className="px-4 pb-3">
              <div className="mx-auto max-w-3xl">
                <AgentOnboardingCard
                  cue={cue}
                  kind={provider}
                  onCancelLogin={onCancelLogin}
                  onContinueUnverified={onContinueUnverified}
                  onDownload={onDownloadAgent}
                  onLogin={onLoginAgent}
                  onSubmitLoginCode={onSubmitLoginCode}
                />
              </div>
            </div>
          )}
          <Composer
            agentLabel={AGENT_LABELS[provider]}
            agentKind={provider}
            attachmentsSupported={Boolean(attachmentSupport?.[provider])}
            blockDirectivesWithAttachments
            disabled={pending || !selected}
            directiveControls={directiveControls}
            isRunning={false}
            mentionItems={mentionItems}
            onMentionQueryChange={(query) => onMentionQueryChange(selected?.cwd, query)}
            runtimeCues={runtimeCues}
            sendBlocked={cue !== undefined}
            currentModeId={modeId}
            currentModel={displayedModel}
            currentEffort={effort}
            agentModels={catalogModels}
            approvalPolicy={approvalPolicy}
            selectableProviders={SELECTABLE_PROVIDERS}
            onSend={handleSend}
            onStop={noop}
            onPickAttachmentFiles={onPickAttachmentFiles}
            onEffortChange={handleEffortChange}
            onModeChange={handleModeChange}
            onModelChange={handleModelChange}
            onApprovalPolicyChange={handlePolicyChange}
            onResetEffort={effort === null ? undefined : handleResetEffort}
            onResetModel={selectedModel === null ? undefined : handleResetModel}
            onProviderChange={handleProviderChange}
            contextBar={
              <NewSessionContextBar
                workspaces={workspaces}
                chatWorkspace={chatWorkspace}
                selected={selected}
                isChatSelected={isChatSelected}
                disabled={pending}
                onSelect={handleWorkspaceChange}
                onPickDirectory={onPickDirectory}
                onRegisterWorkspace={onRegisterWorkspace}
              />
            }
          />
        </div>
      </div>
    </div>
  );
}

function NewSessionContextBar({
  workspaces,
  chatWorkspace,
  selected,
  isChatSelected,
  disabled,
  onSelect,
  onPickDirectory,
  onRegisterWorkspace,
}: {
  workspaces: WorkspaceRecord[];
  chatWorkspace: WorkspaceRecord | null;
  selected: WorkspaceRecord | null;
  isChatSelected: boolean;
  disabled: boolean;
  onSelect: (workspaceId: WorkspaceId) => void;
  onPickDirectory?: () => Promise<string | null>;
  onRegisterWorkspace: (cwd: string) => Promise<WorkspaceRecord>;
}): React.ReactNode {
  const t = useTranslations('workbench.newSession');
  const tSidebar = useTranslations('workbench.sidebar');
  const [registerPending, setRegisterPending] = useState(false);
  const [registerError, setRegisterError] = useState<unknown>(null);

  async function handleChooseDirectory(): Promise<void> {
    if (!onPickDirectory) return;
    setRegisterPending(true);
    setRegisterError(null);
    try {
      const picked = await onPickDirectory();
      if (!picked) return;
      const workspace = await onRegisterWorkspace(picked);
      onSelect(workspace.workspaceId);
    } catch (err) {
      setRegisterError(err);
    } finally {
      setRegisterPending(false);
    }
  }

  const chipLabel = selected
    ? isChatSelected
      ? t('chat')
      : (selected.name ?? repositoryLabel(selected.cwd))
    : t('chooseWorkspace');

  return (
    <div className="flex w-full items-center gap-1 px-2 pt-2 pb-1">
      <Menu>
        <MenuTrigger
          aria-label={t('chooseWorkspace')}
          disabled={disabled || registerPending}
          render={
            <Button className="text-muted-foreground" size="sm" type="button" variant="ghost" />
          }
        >
          {isChatSelected ? <MessagesSquareIcon /> : <FolderIcon />}
          <span className="max-w-48 truncate">{chipLabel}</span>
          <ChevronDownIcon className="size-3 text-muted-foreground/72" />
        </MenuTrigger>
        <MenuPopup align="start" className="w-72" side="top" sideOffset={8}>
          <MenuRadioGroup
            value={selected?.workspaceId ?? ''}
            onValueChange={(value) => onSelect(value as WorkspaceId)}
          >
            {chatWorkspace && (
              <MenuRadioItem closeOnClick value={chatWorkspace.workspaceId}>
                <span className="flex items-center gap-2">
                  <MessagesSquareIcon className="size-4 text-muted-foreground" />
                  {t('chat')}
                </span>
              </MenuRadioItem>
            )}
            {chatWorkspace && workspaces.length > 0 && <MenuSeparator />}
            {workspaces.map((workspace) => (
              <MenuRadioItem key={workspace.workspaceId} closeOnClick value={workspace.workspaceId}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">
                    {workspace.name ?? repositoryLabel(workspace.cwd)}
                  </span>
                  <span className="truncate font-mono text-muted-foreground text-xs">
                    {workspace.cwd}
                  </span>
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          {onPickDirectory && (
            <>
              <MenuSeparator />
              <MenuItem
                onClick={() => {
                  void handleChooseDirectory();
                }}
              >
                <FolderPlusIcon />
                {tSidebar('chooseDirectory')}
              </MenuItem>
            </>
          )}
          {/* TODO(backend): sessions without a working directory — StartOptionsSchema requires a
              non-empty cwd, so "no project" cannot be represented yet; enable once the daemon
              supports cwd-less sessions. */}
          <MenuItem disabled>
            <XIcon />
            {t('noProject')}
          </MenuItem>
        </MenuPopup>
      </Menu>
      {/* TODO(backend): execution-target selection (local host vs remote) — stub until remote hosts exist. */}
      <Button className="text-muted-foreground" disabled size="sm" type="button" variant="ghost">
        <LaptopMinimalIcon />
        {t('workLocally')}
        <ChevronDownIcon className="size-3 text-muted-foreground/72" />
      </Button>
      {/* TODO(backend): branch/worktree selection for the new session — stub until the daemon exposes it. */}
      <Button className="text-muted-foreground" disabled size="sm" type="button" variant="ghost">
        <GitBranchIcon />
        {t('branch')}
        <ChevronDownIcon className="size-3 text-muted-foreground/72" />
      </Button>
      {registerError != null && (
        <span className="min-w-0 truncate text-destructive text-xs">
          {tSidebar('registerWorkspaceError', {
            message: extractErrorMessage(registerError, false) ?? '',
          })}
        </span>
      )}
    </div>
  );
}
