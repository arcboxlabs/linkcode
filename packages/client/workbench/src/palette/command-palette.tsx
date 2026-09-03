import type { SessionId, WorkspaceRecord } from '@linkcode/schema';
import { normalizeCwdKey, workspaceKind } from '@linkcode/schema';
import type { PaletteThreadViewModel } from '@linkcode/ui';
import {
  AGENT_LABELS,
  CommandPalette,
  repositoryLabel,
  useKeyboardShortcutLabels,
} from '@linkcode/ui';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { recentThreadJumpActionId } from '../surface/use-workbench-keyboard-shortcuts';
import type { WorkbenchSessions } from '../surface/use-workbench-sessions';
import { useWorkspaces } from '../workspace/hooks';
import type { PaletteCommand, PaletteThreadCandidate } from './match';
import { matchPaletteCommands, matchPaletteThreads } from './match';
import { useCommandPaletteStore } from './store';

export interface WorkbenchCommandPaletteProps {
  sessions: WorkbenchSessions;
}

/** The palette subtree exists only while open, so closing also resets the query. */
export function WorkbenchCommandPalette({
  sessions,
}: WorkbenchCommandPaletteProps): React.ReactNode {
  const open = useCommandPaletteStore((state) => state.open);
  return open ? <OpenCommandPalette sessions={sessions} /> : null;
}

function OpenCommandPalette({ sessions }: WorkbenchCommandPaletteProps): React.ReactNode {
  const t = useTranslations('workbench.palette');
  const shortcutLabels = useKeyboardShortcutLabels();
  const setOpen = useCommandPaletteStore((state) => state.setOpen);
  const commandsByOwner = useCommandPaletteStore((state) => state.commandsByOwner);
  const { data: workspaces } = useWorkspaces();
  const [query, setQuery] = useState('');

  const workspaceByCwd = new Map(
    (workspaces ?? []).map((workspace) => [normalizeCwdKey(workspace.cwd), workspace]),
  );
  const workspaceById = new Map(
    (workspaces ?? []).map((workspace) => [workspace.workspaceId, workspace]),
  );
  const candidates: PaletteThreadCandidate[] = sessions.sessions.map((session) => {
    const matched = workspaceByCwd.get(normalizeCwdKey(session.cwd));
    let workspace = matched;
    if (matched && workspaceKind(matched) === 'worktree') {
      const parent =
        matched.parentWorkspaceId === undefined
          ? undefined
          : workspaceById.get(matched.parentWorkspaceId);
      workspace = parent && workspaceKind(parent) === 'project' ? parent : undefined;
    }
    return {
      session,
      title: session.title ?? `${AGENT_LABELS[session.kind]} in ${repositoryLabel(session.cwd)}`,
      workspaceLabel:
        workspace && workspaceKind(workspace) !== 'chat' ? workspaceDisplayName(workspace) : null,
    };
  });

  // App commands merge in a deterministic owner order; built-ins always lead.
  const appCommands = Object.keys(commandsByOwner)
    .sort()
    .flatMap((owner) => commandsByOwner[owner]);
  // Included only while traversal is possible — a listed command must always be runnable.
  const navigationCommands: PaletteCommand[] = [
    ...(sessions.canGoBack
      ? [
          {
            id: 'workbench.go-back',
            label: t('goBack'),
            keywords: ['back', 'history'],
            run: sessions.goBack,
          },
        ]
      : []),
    ...(sessions.canGoForward
      ? [
          {
            id: 'workbench.go-forward',
            label: t('goForward'),
            keywords: ['forward', 'history'],
            run: sessions.goForward,
          },
        ]
      : []),
  ];
  let targetWorkspace: WorkspaceRecord | null = null;
  if (workspaces != null) {
    for (let i = 0, len = workspaces.length; i < len; i++) {
      const workspace = workspaces[i];
      if (workspaceKind(workspace) === 'project') {
        targetWorkspace = workspace;
        break;
      }
    }
  }
  const commands: PaletteCommand[] = targetWorkspace
    ? [
        {
          id: 'workbench.new-thread',
          label: t('newThread', { workspace: workspaceDisplayName(targetWorkspace) }),
          // Fastest path: most recently used workspace + the agent kind currently in view.
          run() {
            sessions.create({
              kind: sessions.active?.kind ?? 'claude-code',
              cwd: targetWorkspace.cwd,
            });
          },
        },
        ...navigationCommands,
        ...appCommands,
      ]
    : [...navigationCommands, ...appCommands];

  const matchedThreads = matchPaletteThreads(candidates, query);
  const matchedCommands = matchPaletteCommands(commands, query);
  const threadViewModels: PaletteThreadViewModel[] = matchedThreads.map(
    ({ session, title, workspaceLabel }, index) => ({
      sessionId: session.sessionId,
      title,
      kind: session.kind,
      status: session.status,
      workspaceLabel,
      // ⌘n targets the empty-query Recent ordering; a queried ranking no longer lines up, so
      // hints show only on the Recent view. Labels come from the registry — hints match bindings.
      shortcut: query === '' ? shortcutLabels.get(recentThreadJumpActionId(index + 1)) : undefined,
    }),
  );

  function handleSelectThread(id: SessionId): void {
    setOpen(false);
    sessions.select(id);
  }

  function handleRunCommand(id: string): void {
    const command = commands.find((entry) => entry.id === id);
    setOpen(false);
    command?.run();
  }

  return (
    <CommandPalette
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      threads={threadViewModels}
      commands={matchedCommands.map(({ id, label, shortcut }) => ({
        id,
        label,
        shortcut: shortcut ?? shortcutLabels.get(id),
      }))}
      onSelectThread={handleSelectThread}
      onRunCommand={handleRunCommand}
    />
  );
}

function workspaceDisplayName(workspace: WorkspaceRecord): string {
  return workspace.name ?? repositoryLabel(workspace.cwd);
}
