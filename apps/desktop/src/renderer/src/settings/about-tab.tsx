import type { UpdaterStatus } from '@linkcode/ipc';
import { Button } from 'coss-ui/components/button';
import { Field, FieldLabel } from 'coss-ui/components/field';
import { Progress, ProgressIndicator, ProgressTrack } from 'coss-ui/components/progress';
import { useEffect } from 'foxact/use-abortable-effect';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { systemBridge } from '../ipc';
import { useUpdaterState } from '../updater';

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
  const { progress, status } = useUpdaterState();

  useEffect((signal) => {
    void systemBridge.app.version().then((value) => {
      if (!signal.aborted) setVersion(value);
    });
  }, []);

  const statusKey = status === 'idle' ? null : STATUS_KEYS[status];
  const progressPercent = progress === null ? null : Math.round(progress);

  return (
    <div className="flex flex-col gap-6">
      <Field>
        <FieldLabel>{t('version')}</FieldLabel>
        <span className="font-mono text-muted-foreground text-sm">
          {version ? `v${version}` : '—'}
        </span>
      </Field>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          {/* Main refuses a re-check once an update is downloaded, so offer the install instead of a dead button. */}
          {status === 'downloaded' ? (
            <Button
              size="sm"
              onClick={() => {
                void systemBridge.app.installUpdate();
              }}
            >
              {t('restartToInstall')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void systemBridge.app.checkForUpdates();
              }}
            >
              {t('checkForUpdates')}
            </Button>
          )}
          {statusKey && progressPercent === null ? (
            <span className="text-muted-foreground text-xs">{t(statusKey)}</span>
          ) : null}
        </div>
        {status === 'downloading' && progressPercent !== null ? (
          <Progress
            aria-label={t('status.downloading')}
            className="max-w-sm gap-1.5"
            max={100}
            value={progressPercent}
          >
            <div className="flex items-center justify-between text-muted-foreground text-xs">
              <span>{t('status.downloading')}</span>
              <span className="tabular-nums">{progressPercent}%</span>
            </div>
            <ProgressTrack>
              <ProgressIndicator className="transition-none" />
            </ProgressTrack>
          </Progress>
        ) : null}
      </div>
    </div>
  );
}
