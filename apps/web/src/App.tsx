import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  LinkCodeClient,
  LinkCodeProvider,
  useAgentEvents,
  useLinkCodeClient,
} from '@linkcode/client-core';
import { defaultLocale, getMessages, resolveLocale } from '@linkcode/i18n';
import {
  type AgentEvent,
  type AgentKind,
  AgentKindSchema,
  type ContentBlock,
  type SessionId,
} from '@linkcode/schema';
import { SocketIoTransport } from '@linkcode/transport';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { IntlProvider, useTranslations } from 'use-intl';

/** The web client connects to the local daemon (apps/daemon) over Socket.IO. */
const DAEMON_URL = 'http://127.0.0.1:4317';
const queryClient = new QueryClient();

function createClient(): LinkCodeClient {
  return new LinkCodeClient(new SocketIoTransport({ url: DAEMON_URL }));
}

export function App(): ReactNode {
  const [locale] = useState(getRuntimeLocale);
  const messages = useMemo(() => getMessages(locale), [locale]);

  return (
    <IntlProvider locale={locale} messages={messages}>
      <AppContent />
    </IntlProvider>
  );
}

function AppContent(): ReactNode {
  const [client] = useState(createClient);
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const t = useTranslations('web');
  const common = useTranslations('common');

  useEffect(() => {
    client
      .connect()
      .then(() => setStatus('ready'))
      .catch(() => setStatus('error'));
    return () => client.dispose();
  }, [client]);

  return (
    <QueryClientProvider client={queryClient}>
      <LinkCodeProvider client={client}>
        <main className="mx-auto max-w-[760px] p-6">
          <h1 className="font-heading font-semibold text-lg">{t('title')}</h1>
          {status === 'ready' ? (
            <Workspace />
          ) : status === 'error' ? (
            <p className="mt-4 text-destructive text-sm">
              {t('connectionError', {
                command: common('daemonCommand'),
                url: DAEMON_URL,
              })}
            </p>
          ) : (
            <p className="mt-4 text-muted-foreground">{t('connecting')}</p>
          )}
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
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const events = useAgentEvents(sessionId);
  const pending = usePendingPermissions(events, answered);
  const t = useTranslations('web');
  const common = useTranslations('common');

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
    <div className="mt-4 flex flex-col gap-4">
      <Panel title={t('panels.session')}>
        <div className="flex items-center gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AgentKind)}
            disabled={sessionId !== null}
            className="h-9 rounded-lg border bg-popover px-3 text-foreground text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-64"
          >
            {AgentKindSchema.options.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <Button onClick={start} disabled={sessionId !== null}>
            {sessionId ? t('session.connected', { sessionId }) : t('session.start')}
          </Button>
        </div>
      </Panel>

      {pending.length > 0 && (
        <Panel title={t('panels.permissions')}>
          <div className="flex flex-col gap-2">
            {pending.map((p) => (
              <div key={p.requestId} className="flex items-center gap-2 text-sm">
                <span className="mr-auto text-foreground">
                  {p.toolCall.title ?? p.toolCall.toolCallId}
                </span>
                {p.options.map((o) => (
                  <Button
                    key={o.optionId}
                    variant="secondary"
                    size="sm"
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

      <Panel title={t('panels.messages')}>
        {events.length === 0 ? (
          <p className="text-muted-foreground">{common('unavailable')}</p>
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
          placeholder={
            sessionId ? t('composer.placeholderReady') : t('composer.placeholderDisconnected')
          }
          disabled={!sessionId}
          className="flex-1"
        />
        <Button variant="secondary" onClick={send} disabled={!sessionId}>
          {t('composer.send')}
        </Button>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="rounded-xl border bg-card p-4">
      <header className="mb-3 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
        {title}
      </header>
      {children}
    </section>
  );
}

const ROW = 'whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed';

function contentText(c: ContentBlock, t: ReturnType<typeof useTranslations>): string {
  switch (c.type) {
    case 'text':
      return c.text;
    case 'image':
      return t('image');
    case 'audio':
      return t('audio');
    case 'resource_link':
      return t('resourceLink', { name: c.name });
    case 'resource':
      return t('resource');
  }
}

function EventRow({ event }: { event: AgentEvent }): ReactNode {
  const t = useTranslations('web.events');
  switch (event.type) {
    case 'agent-message-chunk':
    case 'user-message-chunk':
      return <div className={cn(ROW, 'text-foreground')}>{contentText(event.content, t)}</div>;
    case 'agent-thought-chunk':
      return (
        <div className={cn(ROW, 'text-muted-foreground italic')}>
          {contentText(event.content, t)}
        </div>
      );
    case 'tool-call':
      return (
        <div className={cn(ROW, 'text-primary')}>
          ⚙ {event.toolCall.title}{' '}
          <span className="text-muted-foreground">· {event.toolCall.status}</span>
        </div>
      );
    case 'tool-call-update':
      return (
        <div className={cn(ROW, 'text-primary')}>
          ⚙ {event.update.toolCallId} {event.update.status ?? ''}
        </div>
      );
    case 'plan':
      return (
        <div className={cn(ROW, 'text-muted-foreground')}>
          ▤ {event.plan.entries.map((e) => e.content).join('; ')}
        </div>
      );
    case 'available-commands-update':
      return (
        <div className={cn(ROW, 'text-muted-foreground')}>
          / {event.availableCommands.map((c) => c.name).join(', ')}
        </div>
      );
    case 'current-mode-update':
      return (
        <div className={cn(ROW, 'text-muted-foreground')}>
          {t('mode', { modeId: event.currentModeId })}
        </div>
      );
    case 'config-option-update':
      return <div className={cn(ROW, 'text-muted-foreground')}>{t('configUpdated')}</div>;
    case 'status':
      return <div className={cn(ROW, 'text-muted-foreground')}>● {event.status}</div>;
    case 'token-usage':
      return (
        <div className={cn(ROW, 'text-muted-foreground')}>
          ↯ in {event.usage.inputTokens ?? 0} / out {event.usage.outputTokens ?? 0}
        </div>
      );
    case 'stop':
      return <div className={cn(ROW, 'text-muted-foreground')}>■ {event.stopReason}</div>;
    case 'error':
      return <div className={cn(ROW, 'text-destructive')}>⚠ {event.message}</div>;
    case 'permission-request':
      return (
        <div className={cn(ROW, 'text-primary')}>
          ⏵{' '}
          {t('permissionRequest', {
            title: event.toolCall.title ?? event.toolCall.toolCallId,
          })}
        </div>
      );
    case 'client-request':
      return <div className={cn(ROW, 'text-muted-foreground')}>⏵ {event.request.method}</div>;
  }
}

type PermissionRequest = Extract<AgentEvent, { type: 'permission-request' }>;

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

function getRuntimeLocale() {
  if (typeof navigator === 'undefined') return defaultLocale;
  return resolveLocale(navigator.languages);
}
