import type { AgentKind, SessionModeId, WorkspaceId, WorkspaceRecord } from '@linkcode/schema';
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
import { AGENT_MODEL_OPTIONS } from './agent-models';
import { Composer } from './composer';
import { repositoryLabel } from './repository-label';
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
  modeId?: SessionModeId;
  prompt: string;
}

export interface NewSessionSurfaceProps {
  draft: NewSessionDraft;
  /** Project workspaces offered by the picker; the chat workspace arrives separately. */
  workspaces: WorkspaceRecord[];
  chatWorkspace: WorkspaceRecord | null;
  className?: string;
  topContent?: React.ReactNode;
  /** Starts the session and sends the prompt. A rejection keeps the page up — the caller's error
   * banner reports the failure, same contract as the conversation composer. */
  onSubmit: (submission: NewSessionSubmission) => Promise<void>;
  /** Opens the native directory picker; desktop only — omit to hide "Choose directory…". */
  onPickDirectory?: () => Promise<string | null>;
  onRegisterWorkspace: (cwd: string) => Promise<WorkspaceRecord>;
}

const SELECTABLE_PROVIDERS = Object.keys(AGENT_LABELS) as AgentKind[];

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
  onSubmit,
  onPickDirectory,
  onRegisterWorkspace,
}: NewSessionSurfaceProps): React.ReactNode {
  const t = useTranslations('workbench.newSession');
  const [provider, setProvider] = useState(draft.initialProvider);
  const [workspaceId, setWorkspaceId] = useState(draft.initialWorkspaceId);
  const [model, setModel] = useState<string | null>(null);
  const [modeId, setModeId] = useState<string>(DEFAULT_MODE_ID);
  const [pending, setPending] = useState(false);

  const selectableWorkspaces = chatWorkspace ? [chatWorkspace, ...workspaces] : workspaces;
  const selected =
    selectableWorkspaces.find((workspace) => workspace.workspaceId === workspaceId) ?? null;
  const isChatSelected = selected != null && selected === chatWorkspace;

  function handleSend(text: string): void {
    if (!selected) return;
    // The model rides only when it belongs to the submitted provider — mirroring what the
    // composer's trigger displays (a pick made under another provider shows as "Default").
    const providerModels = AGENT_MODEL_OPTIONS[provider];
    const validModel =
      model != null && providerModels?.some((option) => option.id === model) ? model : undefined;
    setPending(true);
    onSubmit({
      kind: provider,
      cwd: selected.cwd,
      workspaceId: selected.workspaceId,
      model: validModel,
      modeId: modeId === DEFAULT_MODE_ID ? undefined : modeId,
      prompt: text,
    })
      .catch(noop)
      .finally(() => setPending(false));
  }

  function handleProviderChange(nextProvider: AgentKind): Promise<void> {
    setProvider(nextProvider);
    return Promise.resolve();
  }

  function handleModelChange(nextModel: string): Promise<void> {
    setModel(nextModel);
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

  return (
    <div className={cn('flex h-full min-h-0 min-w-0 flex-col bg-background', className)}>
      {topContent}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full flex-col justify-center py-8">
          <h1 className="px-4 pb-8 text-center font-semibold text-2xl text-foreground">
            {heading}
          </h1>
          <Composer
            agentLabel={AGENT_LABELS[provider]}
            agentKind={provider}
            disabled={pending || !selected}
            isRunning={false}
            currentModeId={modeId}
            selectableProviders={SELECTABLE_PROVIDERS}
            onSend={handleSend}
            onStop={noop}
            onModeChange={handleModeChange}
            onModelChange={handleModelChange}
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
    <div className="flex w-full items-center gap-1 border-border border-t bg-muted/32 px-2 py-1">
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
          <MenuSeparator />
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
