import type { SessionId, WorkspaceRecord } from '@linkcode/schema';
import { normalizeCwdKey, workspaceKind } from '@linkcode/schema';
import type { PaletteThreadViewModel } from '@linkcode/ui';
import { AGENT_LABELS, CommandPalette, repositoryLabel } from '@linkcode/ui';
import { AnimatePresence } from 'motion/react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import type { WorkbenchSessions } from '../surface/use-workbench-sessions';
import { useWorkspaces } from '../workspace/hooks';
import type { PaletteCommand, PaletteThreadCandidate } from './match';
import { matchPaletteCommands, matchPaletteThreads } from './match';
import { useCommandPaletteStore } from './store';

export interface WorkbenchCommandPaletteProps {
  sessions: WorkbenchSessions;
}

/**
 * The palette container: mounted permanently by `Workbench`, but everything below — data
 * assembly, matching, the dialog — exists only while open, so the closed palette costs nothing
 * and the query resets on close for free. `AnimatePresence` defers the unmount until the
 * dialog's motion exit transition finishes.
 */
export function WorkbenchCommandPalette({
  sessions,
}: WorkbenchCommandPaletteProps): React.ReactNode {
  const open = useCommandPaletteStore((state) => state.open);
  return (
    <AnimatePresence>
      {open && <OpenCommandPalette key="palette" sessions={sessions} />}
    </AnimatePresence>
  );
}

function OpenCommandPalette({ sessions }: WorkbenchCommandPaletteProps): React.ReactNode {
  const t = useTranslations('workbench.palette');
  const setOpen = useCommandPaletteStore((state) => state.setOpen);
  const commandsByOwner = useCommandPaletteStore((state) => state.commandsByOwner);
  const { data: workspaces } = useWorkspaces();
  const [query, setQuery] = useState('');

  const workspaceByCwd = new Map(
    (workspaces ?? []).map((workspace) => [normalizeCwdKey(workspace.cwd), workspace]),
  );
  const candidates: PaletteThreadCandidate[] = sessions.sessions.map((session) => {
    const workspace = workspaceByCwd.get(normalizeCwdKey(session.cwd));
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
  // TODO(keybinds): surface `shortcut` hints here once the global keybind registry exists.
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
  for (const workspace of workspaces ?? []) {
    if (workspaceKind(workspace) !== 'chat') {
      targetWorkspace = workspace;
      break;
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
    ({ session, title, workspaceLabel }) => ({
      sessionId: session.sessionId,
      title,
      kind: session.kind,
      status: session.status,
      workspaceLabel,
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
      open
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      threads={threadViewModels}
      commands={matchedCommands.map(({ id, label, shortcut }) => ({ id, label, shortcut }))}
      onSelectThread={handleSelectThread}
      onRunCommand={handleRunCommand}
    />
  );
}

function workspaceDisplayName(workspace: WorkspaceRecord): string {
  return workspace.name ?? repositoryLabel(workspace.cwd);
}
