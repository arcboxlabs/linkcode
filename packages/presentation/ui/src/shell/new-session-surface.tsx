import type {
  AgentInput,
  AgentKind,
  AgentStartCatalog,
  BranchMode,
  BranchSelection,
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
  MessagesSquareIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { AGENT_LABELS } from '../chat/agent-icon';
import { cn } from '../lib/cn';
import { repositoryLabel } from '../repository-label';
import type { ModelOption } from './agent-models';
import { resolveModel } from './agent-models';
import type { AgentRuntimeCues } from './agent-onboarding-card';
import { AgentOnboardingCard } from './agent-onboarding-card';
import type { ComposerDirectiveControls, MentionItem } from './composer';
import { Composer } from './composer';
import type { ComposerAttachment } from './composer-attachments';
import type { NewSessionBranchPickerComponent } from './new-session-branch-picker';
import { DEFAULT_MODE_ID } from './session-modes';

export interface NewSessionDraft {
  /** Resolved by the workbench (explicit pick → last used → chat → first project); null = none available. */
  initialWorkspaceId: WorkspaceId | null;
  initialHarness: AgentKind;
}

export interface NewSessionSubmission {
  kind: AgentKind;
  cwd: string;
  /** The picked workspace backing `cwd` — lets the caller persist it as the next draft's default. */
  workspaceId: WorkspaceId;
  /** Absent falls back to the agent's persisted pick; there is no "return to default" tier. */
  model?: string;
  /** The account the picked model belongs to, pinning the session to it. */
  accountId?: string;
  /** Null explicitly returns this harness to its default effort. */
  effort?: EffortLevel | null;
  approvalPolicyId?: string;
  modeId?: SessionModeId;
  branch?: BranchSelection;
  input: Extract<AgentInput, { type: 'command' | 'prompt' | 'shell-command' }>;
}

export type AttachmentSupportByAgent = Readonly<Partial<Record<AgentKind, true>>>;
export type AgentStartCatalogs = Readonly<Partial<Record<AgentKind, AgentStartCatalog>>>;

export interface NewSessionSurfaceProps {
  draft: NewSessionDraft;
  /** Project workspaces offered by the picker; the chat workspace arrives separately. */
  workspaces: WorkspaceRecord[];
  chatWorkspace: WorkspaceRecord | null;
  /** The selected workspace. Controlled by the workbench, which needs that same cwd to scope the
   * agent catalogs it feeds back in through `agentCatalogs` — a second copy of this state here
   * would let the two drift and show a default the session would not start in. */
  workspaceId: WorkspaceId | null;
  onWorkspaceChange: (workspaceId: WorkspaceId) => void;
  className?: string;
  topContent?: React.ReactNode;
  /** Runtime availability per agent (CODE-112): a cue renders the onboarding card for the picked
   * harness and blocks sending until the runtime is ready; badges ride the harness submenu. */
  runtimeCues?: AgentRuntimeCues;
  /** Frontend capability stub used until attachment support is advertised by sessions. */
  attachmentSupport?: AttachmentSupportByAgent;
  agentCatalogs?: AgentStartCatalogs;
  /** Harnesses enabled for new threads; null while configuration is loading. */
  selectableHarnesses?: AgentKind[] | null;
  /** The models each agent offers, from every account enabled for it. They lead the picker and their
   * head is the agent's default; the agent's own catalog follows for a run on its own login. */
  accountModels?: Readonly<Partial<Record<AgentKind, ModelOption[]>>> | null;
  /** Last accepted effort per harness. Missing kinds retain the harness default. */
  preferredEfforts?: Readonly<Partial<Record<AgentKind, EffortLevel>>>;
  /** Last successfully used branch and checkout mode per workspace. */
  preferredBranches?: Readonly<Record<string, BranchSelection>>;
  NewSessionBranchPickerComponent?: NewSessionBranchPickerComponent;
  /** Ranked files for the active draft workspace's `@` query. */
  mentionItems: MentionItem[];
  /** Queries files in the draft's currently selected workspace. */
  onMentionQueryChange: (cwd: string | undefined, query: string | null) => void;
  /** Triggers (or retries) the managed download for an agent whose CLI is missing. */
  onDownloadAgent?: (kind: AgentKind) => void;
  /** Accepts an out-of-range detected version — the workbench remembers the (agent, version) pick. */
  onContinueUnverified?: (kind: AgentKind) => void;
  /** Opens Providers settings at the signed-out agent's setup flow. */
  onOpenProviderSettings?: (kind: AgentKind) => void;
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

const SELECTABLE_HARNESSES = Object.keys(AGENT_LABELS) as AgentKind[];

function workspaceById(
  workspaces: readonly WorkspaceRecord[],
  workspaceId: WorkspaceId | null,
): WorkspaceRecord | null {
  if (workspaceId === null) return null;
  for (const workspace of workspaces) {
    if (workspace.workspaceId === workspaceId) return workspace;
  }
  return null;
}

/** Unified new-session page: heading + shared `Composer` + workspace context bar. Model, effort,
 * and workflow-mode picks ride into the submission; the session reflects them from then on. */
export function NewSessionSurface({
  draft,
  workspaces,
  chatWorkspace,
  workspaceId,
  onWorkspaceChange,
  className,
  topContent,
  runtimeCues,
  attachmentSupport,
  agentCatalogs,
  selectableHarnesses,
  accountModels,
  preferredEfforts,
  preferredBranches,
  NewSessionBranchPickerComponent,
  mentionItems,
  onMentionQueryChange,
  onDownloadAgent,
  onContinueUnverified,
  onOpenProviderSettings,
  onSubmit,
  onPickDirectory,
  onRegisterWorkspace,
  onPickAttachmentFiles,
}: NewSessionSurfaceProps): React.ReactNode {
  const t = useTranslations('workbench.newSession');
  const availableHarnesses =
    selectableHarnesses === undefined ? SELECTABLE_HARNESSES : (selectableHarnesses ?? []);
  const [preferredHarness, setPreferredHarness] = useState(draft.initialHarness);
  const harness = availableHarnesses.includes(preferredHarness)
    ? preferredHarness
    : availableHarnesses.at(0);
  const [selectedModels, setSelectedModels] = useState<Partial<Record<AgentKind, string | null>>>(
    {},
  );
  /** The account each picked model belongs to; null once the pick is reset. */
  const [selectedAccounts, setSelectedAccounts] = useState<
    Partial<Record<AgentKind, string | null>>
  >({});
  const [selectedEfforts, setSelectedEfforts] = useState<
    Partial<Record<AgentKind, EffortLevel | null>>
  >({});
  const [modeId, setModeId] = useState<string>(DEFAULT_MODE_ID);
  const [selectedPolicies, setSelectedPolicies] = useState<Partial<Record<AgentKind, string>>>({});
  const [pending, setPending] = useState(false);
  const [selectedBranches, setSelectedBranches] = useState<Record<string, BranchSelection>>({});

  const selectableWorkspaces = chatWorkspace ? [chatWorkspace, ...workspaces] : workspaces;
  const selected = workspaceById(selectableWorkspaces, workspaceId);
  const isChatSelected = selected != null && selected === chatWorkspace;
  const selectedBranch = selected
    ? (selectedBranches[selected.workspaceId] ?? preferredBranches?.[selected.workspaceId])
    : undefined;
  const branchMode = selectedBranch?.mode ?? 'local';
  const catalog = harness === undefined ? undefined : agentCatalogs?.[harness];
  const localModel = harness === undefined ? undefined : selectedModels[harness];
  const selectedModel = localModel === undefined ? null : localModel;
  const localEffort = harness === undefined ? undefined : selectedEfforts[harness];
  const effort =
    localEffort === undefined && harness !== undefined
      ? (preferredEfforts?.[harness] ?? null)
      : (localEffort ?? null);
  // Every offered model comes from an account enabled for this agent, and its head is what an
  // untouched draft runs on — the same entry the daemon derives. The agent's own catalog is
  // deliberately absent: a model nobody enabled an account for is not on offer, so the account
  // switches govern this menu completely rather than sitting beside a list they cannot reach.
  const pickable: ModelOption[] = harness === undefined ? [] : (accountModels?.[harness] ?? []);
  const localAccount = harness === undefined ? undefined : selectedAccounts[harness];
  // `null` is "the accounts have not loaded", so there is no head yet.
  const modelOption =
    selectedModel === null
      ? accountModels === null
        ? undefined
        : pickable[0]
      : resolveModel(pickable, selectedModel, localAccount ?? undefined);
  const displayedModel = selectedModel ?? modelOption?.id ?? null;
  // Effort follows the model the session will actually run on, which is the agent's own default
  // whenever nothing here is offered — the axis stays truthful even with no model to show.
  const effortModel = displayedModel ?? catalog?.defaultModel ?? null;
  const effortLevels = resolveModel(catalog?.models, effortModel)?.effortLevels;
  const constrainedEffort =
    effortLevels === undefined || effortLevels.includes(effort ?? 'low') ? effort : null;
  // A catalog effort paired with a default model belongs to that model: once something else picks
  // the model, that model's own advertised default is the honest value. A catalog that names no
  // default model (claude-code, whose effort setting is model-independent) keeps applying.
  const catalogEffort =
    catalog?.defaultModel === undefined || catalog.defaultModel === effortModel
      ? catalog?.defaultEffort
      : resolveModel(catalog.models, effortModel)?.defaultEffort;
  const displayedEffort =
    constrainedEffort ??
    (catalogEffort !== undefined &&
    (effortLevels === undefined || effortLevels.includes(catalogEffort))
      ? catalogEffort
      : null);
  // Only a real pick travels to the adapter. Every catalog default — policy, model, effort — is a
  // display value: submitting one would read as an explicit choice and override the agent's own
  // startup resolution — claude's `permissions.defaultMode`, codex's configured `config.toml`.
  const pickedPolicyId = harness === undefined ? undefined : selectedPolicies[harness];
  const currentPolicyId =
    pickedPolicyId ?? catalog?.defaultPolicyId ?? catalog?.policies[0]?.policyId;
  const approvalPolicy =
    currentPolicyId && catalog && catalog.policies.length > 0
      ? { availablePolicies: catalog.policies, currentPolicyId }
      : undefined;

  async function submit(input: NewSessionSubmission['input']): Promise<void> {
    if (!selected) throw new Error('Cannot start a session without a workspace');
    if (!harness) throw new Error('Cannot start a session without an enabled harness');
    setPending(true);
    try {
      await onSubmit({
        kind: harness,
        cwd: selected.cwd,
        workspaceId: selected.workspaceId,
        model: localModel === null ? undefined : (selectedModel ?? undefined),
        // Only an account the user actually picked pins the session. Deriving one from an untouched
        // draft would pin whichever account happens to list that model id first, quietly overriding
        // the agent's own default when two accounts serve the same id.
        ...(typeof localAccount === 'string' && { accountId: localAccount }),
        ...(localEffort === null
          ? { effort: null }
          : constrainedEffort !== null && { effort: constrainedEffort }),
        ...(pickedPolicyId && { approvalPolicyId: pickedPolicyId }),
        modeId: modeId === DEFAULT_MODE_ID ? undefined : modeId,
        ...(selectedBranch && { branch: selectedBranch }),
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

  function handleHarnessChange(nextHarness: AgentKind): Promise<void> {
    setPreferredHarness(nextHarness);
    return Promise.resolve();
  }

  function handleModelChange(next: ModelOption): Promise<void> {
    if (!harness) return Promise.resolve();
    setSelectedModels((current) => ({ ...current, [harness]: next.id }));
    // The account is part of the pick: two accounts can serve the same id, and the session must
    // start on the one whose entry was chosen.
    setSelectedAccounts((current) => ({ ...current, [harness]: next.accountId ?? null }));
    return Promise.resolve();
  }

  function handleEffortChange(nextEffort: EffortLevel): Promise<void> {
    if (!harness) return Promise.resolve();
    setSelectedEfforts((current) => ({ ...current, [harness]: nextEffort }));
    return Promise.resolve();
  }

  function handleResetModel(): void {
    if (!harness) return;
    setSelectedModels((current) => ({ ...current, [harness]: null }));
    setSelectedAccounts((current) => ({ ...current, [harness]: null }));
  }

  function handleResetEffort(): void {
    if (!harness) return;
    setSelectedEfforts((current) => ({ ...current, [harness]: null }));
  }

  function handleModeChange(nextModeId: string): Promise<void> {
    setModeId(nextModeId);
    return Promise.resolve();
  }

  function handleApprovalPolicyChange(policyId: string): Promise<void> {
    if (!harness) return Promise.resolve();
    setSelectedPolicies((current) => ({ ...current, [harness]: policyId }));
    return Promise.resolve();
  }

  const heading =
    selected && !isChatSelected
      ? t('headingIn', { name: selected.name ?? repositoryLabel(selected.cwd) })
      : t('heading');
  const cue = harness === undefined ? undefined : runtimeCues?.[harness];
  const capabilities = harness === undefined ? undefined : AGENT_INPUT_CAPABILITIES[harness];
  const directiveControls: ComposerDirectiveControls = {
    slash: capabilities?.slashCommands
      ? { state: 'loading', onInvokeCommand: handleInvokeCommand }
      : { state: 'unsupported' },
    shell: capabilities?.shellCommand
      ? { state: 'ready', onRunShellCommand: handleRunShellCommand }
      : { state: 'unsupported' },
  };

  function handleWorkspaceChange(nextWorkspaceId: WorkspaceId): void {
    onMentionQueryChange(undefined, null);
    onWorkspaceChange(nextWorkspaceId);
  }

  function handleBranchChange(branch: string): void {
    if (!selected) return;
    setSelectedBranches((current) => ({
      ...current,
      [selected.workspaceId]: { name: branch, mode: selectedBranch?.mode ?? 'local' },
    }));
  }

  function handleBranchModeChange(mode: BranchMode): void {
    if (!selected || !selectedBranch) return;
    setSelectedBranches((current) => ({
      ...current,
      [selected.workspaceId]: { ...selectedBranch, mode },
    }));
  }

  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col bg-background', className)}>
      {topContent}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col justify-center py-8">
          <h1 className="px-4 pb-8 text-center font-semibold text-2xl text-foreground">
            {heading}
          </h1>
          {cue && harness && (
            <div className="px-4 pb-3">
              <div className="mx-auto max-w-3xl">
                <AgentOnboardingCard
                  cue={cue}
                  kind={harness}
                  onContinueUnverified={onContinueUnverified}
                  onDownload={onDownloadAgent}
                  onOpenProviderSettings={onOpenProviderSettings}
                />
              </div>
            </div>
          )}
          <Composer
            agentLabel={harness === undefined ? undefined : AGENT_LABELS[harness]}
            agentKind={harness}
            attachmentsSupported={Boolean(harness && attachmentSupport?.[harness])}
            blockDirectivesWithAttachments
            disabled={pending || !selected}
            directiveControls={directiveControls}
            isRunning={false}
            mentionItems={mentionItems}
            onMentionQueryChange={(query) => onMentionQueryChange(selected?.cwd, query)}
            runtimeCues={runtimeCues}
            // A missing runtime or enabled harness blocks sending; account/model failures report themselves.
            sendBlocked={harness === undefined || cue !== undefined}
            currentModeId={modeId}
            currentModel={displayedModel}
            currentEffort={displayedEffort}
            agentModels={pickable.length > 0 ? pickable : null}
            currentAccountId={modelOption?.accountId}
            approvalPolicy={approvalPolicy}
            approvalPolicyPlaceholder={t('permissionMode')}
            selectableHarnesses={availableHarnesses}
            onSend={handleSend}
            onStop={noop}
            onPickAttachmentFiles={onPickAttachmentFiles}
            onEffortChange={handleEffortChange}
            onApprovalPolicyChange={handleApprovalPolicyChange}
            onModeChange={handleModeChange}
            onModelChange={handleModelChange}
            onResetEffort={effort === null ? undefined : handleResetEffort}
            onResetModel={selectedModel === null ? undefined : handleResetModel}
            onHarnessChange={handleHarnessChange}
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
                selectedBranch={selectedBranch?.name}
                branchMode={branchMode}
                onSelectBranch={handleBranchChange}
                onSelectBranchMode={handleBranchModeChange}
                NewSessionBranchPickerComponent={NewSessionBranchPickerComponent}
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
  selectedBranch,
  branchMode,
  onSelectBranch,
  onSelectBranchMode,
  NewSessionBranchPickerComponent,
}: {
  workspaces: WorkspaceRecord[];
  chatWorkspace: WorkspaceRecord | null;
  selected: WorkspaceRecord | null;
  isChatSelected: boolean;
  disabled: boolean;
  onSelect: (workspaceId: WorkspaceId) => void;
  onPickDirectory?: () => Promise<string | null>;
  onRegisterWorkspace: (cwd: string) => Promise<WorkspaceRecord>;
  selectedBranch?: string;
  branchMode: BranchMode;
  onSelectBranch: (branch: string) => void;
  onSelectBranchMode: (mode: BranchMode) => void;
  NewSessionBranchPickerComponent?: NewSessionBranchPickerComponent;
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
          <ChevronDownIcon className="size-3 text-label-tertiary" />
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
      {selected && !isChatSelected && NewSessionBranchPickerComponent && (
        <NewSessionBranchPickerComponent
          branchMode={branchMode}
          cwd={selected.cwd}
          disabled={disabled}
          selectedBranch={selectedBranch}
          onSelect={onSelectBranch}
          onSelectMode={onSelectBranchMode}
        />
      )}
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
