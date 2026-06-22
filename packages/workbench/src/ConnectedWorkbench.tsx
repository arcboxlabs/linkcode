import { LinkCodeProvider, useConversation } from '@linkcode/client-core';
import type { AgentKind, SessionId, SessionInfo } from '@linkcode/schema';
import {
  cancelTurn,
  listSessions,
  promptText,
  respondPermission,
  startSession,
  stopSession,
} from '@linkcode/sdk';
import type { Transport } from '@linkcode/transport';
import { AppShell, type WorkbenchSystemBridge } from '@linkcode/ui';
import { Button } from 'coss-ui/components/button';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { DebugProvider } from './debug';
import { WorkbenchRuntimeProvider } from './runtime';
import { useData, useMutation } from './tayori';

export interface ConnectedWorkbenchProps {
  transport: Transport;
  daemonUrl?: string;
  systemBridge?: WorkbenchSystemBridge;
}

export function ConnectedWorkbench({
  transport,
  daemonUrl,
  systemBridge,
}: ConnectedWorkbenchProps): ReactElement {
  return (
    <DebugProvider>
      <WorkbenchRuntimeProvider
        transport={transport}
        fallback={(status) => <ConnectionState status={status} daemonUrl={daemonUrl} />}
      >
        {(client) => (
          <LinkCodeProvider client={client.raw}>
            <WorkbenchController systemBridge={systemBridge} />
          </LinkCodeProvider>
        )}
      </WorkbenchRuntimeProvider>
    </DebugProvider>
  );
}

function WorkbenchController({
  systemBridge,
}: {
  systemBridge?: WorkbenchSystemBridge;
}): ReactElement {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const sessions = useWorkbenchSessions((err) => setErrorMessage(errorToMessage(err)));
  const conversation = useConversation(sessions.activeId);
  const promptMutation = useMutation(promptText);
  const cancelMutation = useMutation(cancelTurn);
  const permissionMutation = useMutation(respondPermission);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const [responding, setResponding] = useState<Set<string>>(new Set());

  // biome-ignore lint/correctness/useExhaustiveDependencies: answered permission state is scoped to the active session.
  useEffect(() => {
    setAnswered(new Set());
    setResponding(new Set());
  }, [sessions.activeId]);

  function handleSend(text: string): void {
    if (!sessions.activeId) return;
    setErrorMessage(null);
    void promptMutation
      .trigger({ sessionId: sessions.activeId, text })
      .catch((err) => setErrorMessage(errorToMessage(err)));
  }

  function handleStopTurn(): void {
    if (!sessions.activeId) return;
    setErrorMessage(null);
    void cancelMutation
      .trigger({ sessionId: sessions.activeId })
      .catch((err) => setErrorMessage(errorToMessage(err)));
  }

  function handleRespond(requestId: string, optionId: string): void {
    if (!sessions.activeId) return;
    setErrorMessage(null);
    setResponding((prev) => new Set(prev).add(requestId));
    void permissionMutation
      .trigger({
        sessionId: sessions.activeId,
        requestId,
        outcome: { outcome: 'selected', optionId },
      })
      .then(() => {
        setAnswered((prev) => new Set(prev).add(requestId));
      })
      .catch((err) => setErrorMessage(errorToMessage(err)))
      .finally(() => {
        setResponding((prev) => {
          const next = new Set(prev);
          next.delete(requestId);
          return next;
        });
      });
  }

  return (
    <AppShell
      sessions={sessions.sessions}
      activeId={sessions.activeId}
      conversation={conversation}
      answeredPermissions={answered}
      respondingPermissions={responding}
      errorMessage={errorMessage}
      systemBridge={systemBridge}
      onSelectSession={sessions.select}
      onStopSession={sessions.stop}
      onCreateSession={sessions.create}
      onSendPrompt={handleSend}
      onStopTurn={handleStopTurn}
      onRespondPermission={handleRespond}
      onDismissError={() => setErrorMessage(null)}
    />
  );
}

interface WorkbenchSessions {
  sessions: SessionInfo[];
  activeId: SessionId | null;
  select: (id: SessionId) => void;
  create: (opts: { kind: AgentKind; cwd: string }) => void;
  stop: (id: SessionId) => void;
}

function useWorkbenchSessions(onError: (err: unknown) => void): WorkbenchSessions {
  const { data: remoteSessions, mutate } = useData(listSessions, {});
  const createMutation = useMutation(startSession);
  const stopMutation = useMutation(stopSession);
  const [localSessions, setLocalSessions] = useState<SessionInfo[]>([]);
  const [stoppedIds, setStoppedIds] = useState<Set<SessionId>>(new Set());
  const [activeId, setActiveId] = useState<SessionId | null>(null);
  const didAutoSelect = useRef(false);

  const sessions = useMemo(() => {
    const byId = new Map<SessionId, SessionInfo>();
    for (const session of remoteSessions ?? []) {
      if (!stoppedIds.has(session.sessionId)) byId.set(session.sessionId, session);
    }
    for (const session of localSessions) {
      if (!stoppedIds.has(session.sessionId)) byId.set(session.sessionId, session);
    }
    return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
  }, [localSessions, remoteSessions, stoppedIds]);

  useEffect(() => {
    if (didAutoSelect.current || activeId || sessions.length === 0) return;
    didAutoSelect.current = true;
    const preferred =
      sessions.find(
        (session) => session.status === 'running' || session.status === 'awaiting-input',
      ) ?? sessions.at(-1);
    if (preferred) setActiveId(preferred.sessionId);
  }, [activeId, sessions]);

  function create(opts: { kind: AgentKind; cwd: string }): void {
    void createMutation
      .trigger({ opts })
      .then((sessionId) => {
        const optimistic: SessionInfo = {
          sessionId,
          kind: opts.kind,
          cwd: opts.cwd,
          status: 'starting',
          createdAt: Date.now(),
        };
        setStoppedIds((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
        setLocalSessions((prev) =>
          prev.some((session) => session.sessionId === sessionId) ? prev : [...prev, optimistic],
        );
        setActiveId(sessionId);
        void mutate();
      })
      .catch((err) => {
        onError(err);
      });
  }

  function stop(id: SessionId): void {
    void stopMutation
      .trigger({ sessionId: id })
      .then(() => {
        setStoppedIds((prev) => new Set(prev).add(id));
        setLocalSessions((prev) => prev.filter((session) => session.sessionId !== id));
        setActiveId((current) => (current === id ? null : current));
        void mutate();
      })
      .catch((err) => {
        onError(err);
      });
  }

  return {
    sessions,
    activeId,
    select: setActiveId,
    create,
    stop,
  };
}

function errorToMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function ConnectionState({
  status,
  daemonUrl,
}: {
  status: 'connecting' | 'error';
  daemonUrl?: string;
}): ReactElement {
  const t = useTranslations('workbench.connection');
  const common = useTranslations('common');

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        {status === 'connecting' ? (
          <p className="text-muted-foreground text-sm">{t('connecting')}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-destructive-foreground text-sm">
              {t('error', {
                url: daemonUrl ?? '127.0.0.1:4317',
                command: common('daemonCommand'),
              })}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                window.location.reload();
              }}
            >
              {t('retry')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
