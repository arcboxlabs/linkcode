import { LinkCodeClient, LinkCodeProvider } from '@linkcode/client-core';
import { type Locale, defaultLocale, getMessages, resolveLocale } from '@linkcode/i18n';
import type { Transport } from '@linkcode/transport';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { IntlProvider, useTranslations } from 'use-intl';
import { Button } from './components/ui';
import { AppShell } from './shell';
import type { WorkbenchSystemBridge } from './shell/types';

export interface WorkbenchProps {
  /** Transport to the daemon (e.g. a SocketIoTransport). The client is built around it. */
  transport: Transport;
  /** Daemon address, shown only in the connection-error message. */
  daemonUrl?: string;
  /** Desktop system bridge for window controls (optional). */
  systemBridge?: WorkbenchSystemBridge;
  /** Force a locale; defaults to the runtime navigator locale. */
  locale?: Locale;
}

function runtimeLocale(): Locale {
  if (typeof navigator === 'undefined') return defaultLocale;
  return resolveLocale(navigator.languages);
}

/**
 * The shared Link Code frontend mounted by both `apps/web` and `apps/desktop`. It owns i18n, the daemon
 * connection lifecycle, and the app shell — apps only construct a transport and render this.
 */
export function Workbench({
  transport,
  daemonUrl,
  systemBridge,
  locale,
}: WorkbenchProps): ReactElement {
  const resolved = locale ?? runtimeLocale();
  const messages = useMemo(() => getMessages(resolved), [resolved]);

  return (
    <IntlProvider locale={resolved} messages={messages}>
      <WorkbenchInner transport={transport} daemonUrl={daemonUrl} systemBridge={systemBridge} />
    </IntlProvider>
  );
}

function WorkbenchInner({
  transport,
  daemonUrl,
  systemBridge,
}: {
  transport: Transport;
  daemonUrl?: string;
  systemBridge?: WorkbenchSystemBridge;
}): ReactElement {
  const t = useTranslations('workbench.connection');
  const common = useTranslations('common');
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

  if (status === 'ready') {
    return (
      <LinkCodeProvider client={client}>
        <AppShell systemBridge={systemBridge} />
      </LinkCodeProvider>
    );
  }

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
                if (typeof window !== 'undefined') window.location.reload();
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
