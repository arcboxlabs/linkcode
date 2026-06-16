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
import { type ReactNode, useEffect, useState } from 'react';
import { systemBridge } from './ipc';

const FIELD =
  'rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-accent';

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
    <LinkCodeProvider client={client}>
      <div className="flex h-full flex-col">
        <TitleBar />
        <main className="flex-1 overflow-auto p-6">
          {ready ? <Workspace /> : <p className="text-muted">连接中…</p>}
        </main>
      </div>
    </LinkCodeProvider>
  );
}

/** Title bar: demonstrates data-plane / system-plane separation — window controls go through TypeSafe IPC (tRPC) and never touch business data. */
function TitleBar(): ReactNode {
  return (
    <header className="flex h-10 items-center justify-end gap-2 border-b border-border bg-surface px-3 [-webkit-app-region:drag]">
      <strong className="mr-auto text-xs text-muted">Link Code · Desktop</strong>
      <div className="flex gap-2 [-webkit-app-region:no-drag]">
        <Button variant="ghost" onClick={() => void systemBridge.window.minimize.mutate()}>
          —
        </Button>
        <Button variant="ghost" onClick={() => void systemBridge.window.toggleMaximize.mutate()}>
          ☐
        </Button>
        <Button variant="ghost" onClick={() => void systemBridge.window.close.mutate()}>
          ✕
        </Button>
      </div>
    </header>
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
    <div className="mx-auto flex max-w-[760px] flex-col gap-4">
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
