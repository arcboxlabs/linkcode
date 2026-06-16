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
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { systemBridge } from './ipc';

type DragCSS = CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' };

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
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <TitleBar />
        <main style={{ flex: 1, overflow: 'auto', padding: tokens.space(6) }}>
          {ready ? <Workspace /> : <p style={{ color: tokens.color.textMuted }}>连接中…</p>}
        </main>
      </div>
    </LinkCodeProvider>
  );
}

/** Title bar: demonstrates the data plane / system plane separation—window controls go through TypeSafe IPC (tRPC) and never touch business data. */
function TitleBar(): ReactNode {
  const bar: DragCSS = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: tokens.space(2),
    height: 40,
    padding: `0 ${tokens.space(3)}px`,
    borderBottom: `1px solid ${tokens.color.border}`,
    background: tokens.color.surface,
    WebkitAppRegion: 'drag',
  };
  const noDrag: DragCSS = { WebkitAppRegion: 'no-drag' };

  return (
    <header style={bar}>
      <strong style={{ marginRight: 'auto', fontSize: 12, color: tokens.color.textMuted }}>
        Link Code · Desktop
      </strong>
      <div style={{ display: 'flex', gap: tokens.space(2), ...noDrag }}>
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space(4),
        maxWidth: 760,
        margin: '0 auto',
      }}
    >
      <Panel title="会话">
        <div style={{ display: 'flex', gap: tokens.space(2), alignItems: 'center' }}>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AgentKind)}
            disabled={sessionId !== null}
            style={fieldStyle}
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
          style={{ ...fieldStyle, flex: 1 }}
        />
        <Button onClick={send} disabled={!sessionId}>
          发送
        </Button>
      </div>
    </div>
  );
}

const fieldStyle: CSSProperties = {
  background: tokens.color.surface,
  color: tokens.color.text,
  border: `1px solid ${tokens.color.border}`,
  borderRadius: tokens.radius.sm,
  padding: `${tokens.space(2)}px ${tokens.space(3)}px`,
  fontFamily: tokens.font.sans,
  fontSize: 13,
};
