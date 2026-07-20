import { DAEMON_DEFAULT_URL } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { useTranslations } from 'use-intl';
import {
  useWorkbenchRuntimeEndpoint,
  useWorkbenchRuntimeRetry,
  useWorkbenchRuntimeStatus,
} from '../runtime/provider';

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
  const endpoint = useWorkbenchRuntimeEndpoint();
  const retry = useWorkbenchRuntimeRetry();
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
              {managedHost
                ? t('errorManaged', { url: endpoint ?? daemonUrl ?? DAEMON_DEFAULT_URL })
                : t('error', {
                    url: endpoint ?? daemonUrl ?? DAEMON_DEFAULT_URL,
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
