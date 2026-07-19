import type {
  AgentKind,
  AgentStartCatalog,
  ContentBlock,
  EffortLevel,
  SessionModeId,
  WorkspaceId,
  WorkspaceRecord,
} from '@linkcode/schema';
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
import { AGENT_MODEL_OPTIONS } from './agent-models';
import type { AgentRuntimeCues } from './agent-onboarding-card';
import { AgentOnboardingCard } from './agent-onboarding-card';
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
  model?: string;
  effort?: EffortLevel;
  approvalPolicyId?: string;
  modeId?: SessionModeId;
  content: ContentBlock[];
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

/** The provider-scoped picker state the surface accumulates before submission. */
export interface NewSessionPicks {
  provider: AgentKind;
  model: string | null;
  effort: EffortLevel | null;
  policyId: string | null;
  modeId: string;
}

/**
 * Fold the picker state and the provider's catalog into the submission's optional fields — pure
 * so the ride/skip rules are unit-testable: a model rides only when the picked provider actually
 * offers it (dynamic catalog first, static table fallback); the approval tier rides only when it
 * diverges from the catalog default (the adapter starts there anyway).
 */
export function deriveNewSessionPicks(
  picks: NewSessionPicks,
  catalog: AgentStartCatalog | undefined,
): Pick<NewSessionSubmission, 'model' | 'effort' | 'approvalPolicyId' | 'modeId'> {
  const catalogModels = catalog !== undefined && catalog.models.length > 0 ? catalog.models : null;
  const providerModels = catalogModels ?? AGENT_MODEL_OPTIONS[picks.provider];
  const defaultPolicyId =
    catalog === undefined ? undefined : (catalog.defaultPolicyId ?? catalog.policies[0]?.policyId);
  const pickedPolicyId =
    picks.policyId !== null && catalog?.policies.some((p) => p.policyId === picks.policyId)
      ? picks.policyId
      : undefined;
  return {
    model:
      picks.model !== null && providerModels?.some((option) => option.id === picks.model)
        ? picks.model
        : undefined,
    effort: picks.effort ?? undefined,
    approvalPolicyId:
      pickedPolicyId !== undefined && pickedPolicyId !== defaultPolicyId
        ? pickedPolicyId
        : undefined,
    modeId: picks.modeId === DEFAULT_MODE_ID ? undefined : picks.modeId,
  };
}

/**
 * The unified new-session page rendered in the main column while drafting: heading + the shared
 * `Composer` (its provider submenu picks the agent) + a context bar carrying the workspace picker.
 * Model / workflow-mode picks ride into the submission; the session reflects them from then on.
 */
export function NewSessionSurface({
  draft,
  workspaces,
  chatWorkspace,
  className,
  topContent,
  runtimeCues,
  attachmentSupport,
  agentCatalogs,
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
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<EffortLevel | null>(null);
  const [policyId, setPolicyId] = useState<string | null>(null);
  const [modeId, setModeId] = useState<string>(DEFAULT_MODE_ID);
  const [pending, setPending] = useState(false);

  const selectableWorkspaces = chatWorkspace ? [chatWorkspace, ...workspaces] : workspaces;
  const selected =
    selectableWorkspaces.find((workspace) => workspace.workspaceId === workspaceId) ?? null;
  const isChatSelected = selected != null && selected === chatWorkspace;

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

  function handleSend(content: ContentBlock[]): void {
    if (!selected) return;
    setPending(true);
    onSubmit({
      kind: provider,
      cwd: selected.cwd,
      workspaceId: selected.workspaceId,
      ...deriveNewSessionPicks({ provider, model, effort, policyId, modeId }, catalog),
      content,
    })
      .catch(noop)
      .finally(() => setPending(false));
  }

  function handleProviderChange(nextProvider: AgentKind): Promise<void> {
    setProvider(nextProvider);
    // Model ids, effort axes, and policy tiers are all provider-scoped: stale picks must not
    // leak across a provider switch.
    setModel(null);
    setEffort(null);
    setPolicyId(null);
    return Promise.resolve();
  }

  function handleModelChange(nextModel: string): Promise<void> {
    setModel(nextModel);
    return Promise.resolve();
  }

  function handleEffortChange(nextEffort: EffortLevel): Promise<void> {
    setEffort(nextEffort);
    return Promise.resolve();
  }

  function handlePolicyChange(nextPolicyId: string): Promise<void> {
    setPolicyId(nextPolicyId);
    return Promise.resolve();
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
            disabled={pending || !selected}
            isRunning={false}
            runtimeCues={runtimeCues}
            sendBlocked={cue !== undefined}
            currentModeId={modeId}
            currentModel={model}
            currentEffort={effort}
            agentModels={catalogModels}
            approvalPolicy={approvalPolicy}
            selectableProviders={SELECTABLE_PROVIDERS}
            onSend={handleSend}
            onStop={noop}
            onPickAttachmentFiles={onPickAttachmentFiles}
            onModeChange={handleModeChange}
            onModelChange={handleModelChange}
            onEffortChange={handleEffortChange}
            onApprovalPolicyChange={handlePolicyChange}
            onProviderChange={handleProviderChange}
            contextBar={
              <NewSessionContextBar
                workspaces={workspaces}
                chatWorkspace={chatWorkspace}
                selected={selected}
                isChatSelected={isChatSelected}
                disabled={pending}
                onSelect={setWorkspaceId}
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
