import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  LinkCodeClient,
  LinkCodeProvider,
  useAgentEvents,
  useLinkCodeClient,
} from '@linkcode/client-core';
import { Host } from '@linkcode/host';
import { type AgentEvent, type AgentKind, AgentKindSchema, type SessionId } from '@linkcode/schema';
import { createLocalTransportPair } from '@linkcode/transport';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';

const queryClient = new QueryClient();

/**
 * Self-contained demo: runs a Host inside the browser (direct local connection)
 * to exercise the entire data path: schema → transport → host (adapter stub) → client-core.
 * UI is Coss UI (components under @/components/ui, tokens in src/coss.css).
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
          <h1 className="font-heading text-lg font-semibold">Link Code · Web</h1>
          {ready ? <Workspace /> : <p className="text-muted-foreground">连接中…</p>}
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
            className="h-9 rounded-lg border bg-popover px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-64"
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
        {events.length === 0 ? (
          <p className="text-muted-foreground">暂无消息。</p>
        ) : (
          <div className="flex flex-col gap-2">
            {events.map((event, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only event stream; index key is fine for the scaffold
              <EventRow key={i} event={event} />
            ))}
          </div>
        )}
      </Panel>

      <div className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          placeholder={sessionId ? '输入消息…' : '请先启动会话'}
          disabled={!sessionId}
          className="flex-1"
        />
        <Button variant="secondary" onClick={send} disabled={!sessionId}>
          发送
        </Button>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="rounded-xl border bg-card p-4">
      <header className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </header>
      {children}
    </section>
  );
}

const ROW = 'whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed';

function EventRow({ event }: { event: AgentEvent }): ReactNode {
  switch (event.type) {
    case 'assistant-delta':
      return <div className={cn(ROW, 'text-foreground')}>{event.text}</div>;
    case 'tool-call':
      return <div className={cn(ROW, 'text-primary')}>⚙ {event.call.name}</div>;
    case 'tool-result':
      return (
        <div className={cn(ROW, event.ok ? 'text-success' : 'text-destructive')}>
          {event.ok ? '✓' : '✗'} tool {event.callId}
        </div>
      );
    case 'status':
      return <div className={cn(ROW, 'text-muted-foreground')}>● {event.status}</div>;
    case 'error':
      return <div className={cn(ROW, 'text-destructive')}>⚠ {event.message}</div>;
  }
}
