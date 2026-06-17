import {
  LinkCodeClient,
  LinkCodeProvider,
  useConversation,
  useLinkCodeClient,
  useSessions,
} from '@linkcode/client-core';
import type { AgentKind, SessionId } from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { AppShell, Button, type WorkbenchSystemBridge } from '@linkcode/ui';
import { type ReactElement, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';

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
  const [client] = useState(() => new LinkCodeClient(transport));
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');

  useEffect(() => {
    let alive = true;
    client
      .connect()
      .then(() => {
        if (alive) setStatus('ready');
      })
      .catch(() => {
        if (alive) setStatus('error');
      });
    return () => {
      alive = false;
      client.dispose();
    };
  }, [client]);

  if (status !== 'ready') {
    return <ConnectionState status={status} daemonUrl={daemonUrl} />;
  }

  return (
    <LinkCodeProvider client={client}>
      <WorkbenchController systemBridge={systemBridge} />
    </LinkCodeProvider>
  );
}

function WorkbenchController({
  systemBridge,
}: {
  systemBridge?: WorkbenchSystemBridge;
}): ReactElement {
  const client = useLinkCodeClient();
  const sessions = useSessions();
  const conversation = useConversation(sessions.activeId);
  const [answered, setAnswered] = useState<Set<string>>(new Set());

  useEffect(() => {
    setAnswered(new Set());
  }, [sessions.activeId]);

  function handleSend(text: string): void {
    if (sessions.activeId) client.promptText(sessions.activeId, text);
  }

  function handleStopTurn(): void {
    if (sessions.activeId) client.cancel(sessions.activeId);
  }

  function handleRespond(requestId: string, optionId: string): void {
    if (!sessions.activeId) return;
    client.respondPermission(sessions.activeId, requestId, { outcome: 'selected', optionId });
    setAnswered((prev) => new Set(prev).add(requestId));
  }

  function handleCreate(opts: { kind: AgentKind; cwd: string }): void {
    void sessions.create(opts);
  }

  return (
    <AppShell
      sessions={sessions.sessions}
      activeId={sessions.activeId}
      conversation={conversation}
      answeredPermissions={answered}
      systemBridge={systemBridge}
      onSelectSession={(id: SessionId) => sessions.select(id)}
      onStopSession={(id: SessionId) => sessions.stop(id)}
      onCreateSession={handleCreate}
      onSendPrompt={handleSend}
      onStopTurn={handleStopTurn}
      onRespondPermission={handleRespond}
    />
  );
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
