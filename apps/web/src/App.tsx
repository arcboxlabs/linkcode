import {
  LinkCodeClient,
  LinkCodeProvider,
  useAgentEvents,
  useLinkCodeClient,
} from '@linkcode/client-core';
import { Host } from '@linkcode/host';
import { type AgentKind, AgentKindSchema, type SessionId } from '@linkcode/schema';
import { createLocalTransportPair } from '@linkcode/transport';
import { Button, MessageView, Panel, tokens } from '@linkcode/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';

const queryClient = new QueryClient();

/**
 * 自包含 demo：浏览器内同时跑一个 Host（本地直连），打通
 * schema → transport → host(adapter 桩) → client-core → ui 的整条数据面。
 * 真实部署时 Host 为本机独立进程，Web 经 LocalTransport / WsTransport 连接。
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
        <main style={{ maxWidth: 720, margin: '0 auto', padding: tokens.space(6) }}>
          <h1 style={{ fontSize: 18, fontWeight: 600 }}>Link Code · Web</h1>
          {ready ? <Workspace /> : <p style={{ color: tokens.color.textMuted }}>连接中…</p>}
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space(4),
        marginTop: tokens.space(4),
      }}
    >
      <Panel title="会话">
        <div style={{ display: 'flex', gap: tokens.space(2), alignItems: 'center' }}>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AgentKind)}
            disabled={sessionId !== null}
            style={selectStyle}
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

      <div style={{ display: 'flex', gap: tokens.space(2) }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder={sessionId ? '输入消息…' : '请先启动会话'}
          disabled={!sessionId}
          style={{ ...selectStyle, flex: 1 }}
        />
        <Button onClick={send} disabled={!sessionId}>
          发送
        </Button>
      </div>
    </div>
  );
}

const selectStyle: CSSProperties = {
  background: tokens.color.surface,
  color: tokens.color.text,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: tokens.radius.sm,
  padding: `${tokens.space(2)}px ${tokens.space(3)}px`,
  fontFamily: tokens.font.sans,
  fontSize: 13,
};
