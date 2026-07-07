import { DAEMON_DEFAULT_URL } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { useAbortableEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useWorkbenchRuntimeRetry, useWorkbenchRuntimeStatus } from '../runtime/provider';

/**
 * A supervised daemon needs a beat to boot (fork + engine + listener bind); early dial failures
 * within this window after the gate opens are startup, not an outage — keep showing "connecting".
 */
const MANAGED_STARTUP_GRACE_MS = 10000;

/** Default connection-gate fallback: shown while the transport connects or after it errored. */
export function ConnectionState({
  daemonUrl,
  managedHost = false,
}: {
  daemonUrl?: string;
  /** The host restarts itself (desktop supervisor) — drop the "run this command" hint. */
  managedHost?: boolean;
}): React.ReactNode {
  const status = useWorkbenchRuntimeStatus();
  const retry = useWorkbenchRuntimeRetry();
  const t = useTranslations('workbench.connection');
  const common = useTranslations('common');

  const [withinStartupGrace, setWithinStartupGrace] = useState(true);
  useAbortableEffect((signal) => {
    const timer = setTimeout(() => {
      if (!signal.aborted) setWithinStartupGrace(false);
    }, MANAGED_STARTUP_GRACE_MS);
    signal.addEventListener('abort', () => clearTimeout(timer));
  }, []);

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        {status === 'connecting' || (managedHost && withinStartupGrace) ? (
          <p className="text-muted-foreground text-sm">{t('connecting')}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-destructive-foreground text-sm">
              {managedHost
                ? t('errorManaged', { url: daemonUrl ?? DAEMON_DEFAULT_URL })
                : t('error', {
                    url: daemonUrl ?? DAEMON_DEFAULT_URL,
                    command: common('daemonCommand'),
                  })}
            </p>
            <Button variant="outline" size="sm" onClick={retry}>
              {t('retry')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
