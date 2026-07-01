import { Button } from 'coss-ui/components/button';
import { useTranslations } from 'use-intl';
import { useWorkbenchRuntimeRetry, useWorkbenchRuntimeStatus } from '../runtime/provider';

/** Default connection-gate fallback: shown while the transport connects or after it errored. */
export function ConnectionState({ daemonUrl }: { daemonUrl?: string }): React.ReactNode {
  const status = useWorkbenchRuntimeStatus();
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
              {t('error', {
                url: daemonUrl ?? '127.0.0.1:4317',
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
