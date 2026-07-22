import type { UpdaterStatus } from '@linkcode/ipc';
import { Button } from 'coss-ui/components/button';
import { Field, FieldLabel } from 'coss-ui/components/field';
import { useEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { systemBridge } from '../ipc';

const STATUS_KEYS = {
  checking: 'status.checking',
  available: 'status.available',
  'not-available': 'status.notAvailable',
  downloading: 'status.downloading',
  downloaded: 'status.downloaded',
  error: 'status.error',
} as const satisfies Partial<Record<UpdaterStatus, string>>;

export function AboutTab(): React.ReactNode {
  const t = useTranslations('settings.about');
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState<UpdaterStatus>('idle');

  useEffect((signal) => {
    void systemBridge.app.version().then((value) => {
      if (!signal.aborted) setVersion(value);
    });
    const unsubscribe = systemBridge.app.onUpdaterStatus(setStatus);
    return () => unsubscribe();
  }, []);

  const statusKey = status === 'idle' ? null : STATUS_KEYS[status];

  return (
    <div className="flex flex-col gap-6">
      <Field>
        <FieldLabel>{t('version')}</FieldLabel>
        <span className="font-mono text-muted-foreground text-sm">
          {version ? `v${version}` : '—'}
        </span>
      </Field>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setStatus('checking');
            void systemBridge.app.checkForUpdates();
          }}
        >
          {t('checkForUpdates')}
        </Button>
        {statusKey ? <span className="text-muted-foreground text-xs">{t(statusKey)}</span> : null}
      </div>
    </div>
  );
}
