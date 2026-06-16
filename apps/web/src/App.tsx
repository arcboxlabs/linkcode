import {
  LinkCodeClient,
  LinkCodeProvider,
  useAgentEvents,
  useLinkCodeClient,
} from '@linkcode/client-core';
import { Host } from '@linkcode/host';
import { type AgentKind, AgentKindSchema, type SessionId } from '@linkcode/schema';
import { createLocalTransportPair } from '@linkcode/transport';
import { Button, MessageView, Panel } from '@linkcode/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';

const queryClient = new QueryClient();

const FIELD =
  'rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-accent';

/**
 * Self-contained demo: runs a Host inside the browser (direct local connection)
 * to exercise the entire data path: schema → transport → host (adapter stub) → client-core → ui.
 * In a real deployment the Host is a separate process on the local machine, and the Web
 * client connects to it via LocalTransport / WsTransport.
 */
function createConnectedClient(): LinkCodeClient {
  const [clientSide, hostSide] = createLocalTransportPair();
  void new Host(hostSide).start();
  return new LinkCodeClient(clientSide);
}

export function App(): ReactNode {
  const [client] = useState(createConnectedClient);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    client.connect().then(() => setReady(true));
    return () => client.dispose();
  }, [client]);

  return (
    <QueryClientProvider client={queryClient}>
      <LinkCodeProvider client={client}>
        <main className="mx-auto max-w-[720px] p-6">
          <h1 className="text-lg font-semibold">Link Code · Web</h1>
          {ready ? <Workspace /> : <p className="text-muted">连接中…</p>}
        </main>
      </LinkCodeProvider>
    </QueryClientProvider>
  );
}

function Workspace(): ReactNode {
  const client = useLinkCodeClient();
  const [kind, setKind] = useState<AgentKind>('claude-code');
  const [sessionId, setSessionId] = useState<SessionId | null>(null);
  const [text, setText] = useState('');
  const events = useAgentEvents(sessionId);

  async function start() {
    setSessionId(await client.startSession({ kind, cwd: '/demo' }));
  }

  function send() {
    if (sessionId && text.trim()) {
      client.send(sessionId, { type: 'user-message', text: text.trim() });
      setText('');
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <Panel title="会话">
        <div className="flex items-center gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AgentKind)}
            disabled={sessionId !== null}
            className={FIELD}
          >
            {AgentKindSchema.options.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <Button onClick={start} disabled={sessionId !== null}>
            {sessionId ? `已连接 · ${sessionId}` : '启动会话'}
          </Button>
        </div>
      </Panel>

      <Panel title="消息">
        <MessageView events={events} />
      </Panel>

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder={sessionId ? '输入消息…' : '请先启动会话'}
          disabled={!sessionId}
          className={`${FIELD} flex-1`}
        />
        <Button onClick={send} disabled={!sessionId}>
          发送
        </Button>
      </div>
    </div>
  );
}
