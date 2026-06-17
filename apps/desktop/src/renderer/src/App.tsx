import {
  LinkCodeClient,
  LinkCodeProvider,
  useAgentEvents,
  useLinkCodeClient,
} from '@linkcode/client-core';
import { type AgentEvent, type AgentKind, AgentKindSchema, type SessionId } from '@linkcode/schema';
import { WsTransport } from '@linkcode/transport';
import { Button, MessageView, Panel } from '@linkcode/ui';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { systemBridge } from './ipc';

/** The desktop renderer connects to the local daemon (apps/daemon) like every other client. */
const DAEMON_URL = 'ws://127.0.0.1:4317';
const FIELD =
  'rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-text outline-none focus:border-accent';

function createClient(): LinkCodeClient {
  return new LinkCodeClient(new WsTransport({ url: DAEMON_URL }));
}

export function App(): ReactNode {
  const [client] = useState(createClient);
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');

  useEffect(() => {
    client
      .connect()
      .then(() => setStatus('ready'))
      .catch(() => setStatus('error'));
    return () => client.dispose();
  }, [client]);

  return (
    <LinkCodeProvider client={client}>
      <div className="flex h-full flex-col">
        <TitleBar />
        <main className="flex-1 overflow-auto p-6">
          {status === 'ready' ? (
            <Workspace />
          ) : status === 'error' ? (
            <p className="text-danger">
              无法连接到 daemon（{DAEMON_URL}）。请先运行{' '}
              <code>pnpm --filter @linkcode/daemon dev</code>。
            </p>
          ) : (
            <p className="text-muted">连接中…</p>
          )}
        </main>
      </div>
    </LinkCodeProvider>
  );
}

/** Title bar: window controls go through TypeSafe IPC (tRPC) and never touch business data. */
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
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const events = useAgentEvents(sessionId);
  const pending = usePendingPermissions(events, answered);

  async function start() {
    setSessionId(await client.startSession({ kind, cwd: '/demo' }));
  }
  function send() {
    if (sessionId && text.trim()) {
      client.promptText(sessionId, text.trim());
      setText('');
    }
  }
  function answer(requestId: string, optionId: string) {
    if (sessionId)
      client.respondPermission(sessionId, requestId, { outcome: 'selected', optionId });
    setAnswered((prev) => new Set(prev).add(requestId));
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

      {pending.length > 0 && (
        <Panel title="待确认权限">
          <div className="flex flex-col gap-2">
            {pending.map((p) => (
              <div key={p.requestId} className="flex items-center gap-2 text-[13px] text-text">
                <span className="mr-auto">{p.toolCall.title ?? p.toolCall.toolCallId}</span>
                {p.options.map((o) => (
                  <Button
                    key={o.optionId}
                    variant="ghost"
                    onClick={() => answer(p.requestId, o.optionId)}
                  >
                    {o.name}
                  </Button>
                ))}
              </div>
            ))}
          </div>
        </Panel>
      )}

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

type PermissionRequest = Extract<AgentEvent, { type: 'permission-request' }>;

/** Pending (unanswered) permission requests pulled out of the event stream. */
function usePendingPermissions(events: AgentEvent[], answered: Set<string>): PermissionRequest[] {
  return useMemo(
    () =>
      events.filter(
        (e): e is PermissionRequest =>
          e.type === 'permission-request' && !answered.has(e.requestId),
      ),
    [events, answered],
  );
}
