import type { SimulatorStatus } from '@linkcode/schema';
import { cn } from '@linkcode/ui';
import { Button } from 'coss-ui/components/button';
import { CheckIcon, CircleDashedIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';

/** The provisioning steps, in the order they must happen. */
const STEPS = ['xcode', 'runtime', 'devices'] as const;

/**
 * What a host still needs before it can run a simulator, as a checklist that ticks itself off.
 *
 * The panel re-probes on a timer while this is showing, so a step finished in Xcode (or by the
 * download button) marks itself done without a restart — the alternative, a single "unavailable"
 * line, leaves a user with no idea which of three different things is missing.
 */
export function SimulatorSetupChecklist({
  status,
  onInstallRuntime,
  installing,
}: {
  status: SimulatorStatus;
  /** Starts the iOS runtime download; absent while one is already running. */
  onInstallRuntime?: () => void;
  installing: boolean;
}): React.ReactNode {
  const t = useTranslations('workbench.panel');
  // Everything before the blocker is finished by definition: the host could not have reported
  // "no runtime" without Xcode being present to answer.
  const blocking = status.blocker ?? null;
  const blockedAt = blocking === null ? STEPS.length : STEPS.indexOf(blocking);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-sm">
      <p className="text-center font-medium">{t('simulatorSetupTitle')}</p>
      <ol className="flex w-full max-w-xs flex-col gap-2.5">
        {STEPS.map((step, index) => {
          const done = index < blockedAt;
          const current = index === blockedAt;
          return (
            <li
              key={step}
              className={cn(
                'flex items-start gap-2.5',
                !done && !current && 'text-muted-foreground/60',
              )}
            >
              <StepIcon done={done} />
              <div className="flex flex-col gap-1">
                <span className={cn(done && 'text-muted-foreground line-through')}>
                  {t(`simulatorSetupStep.${step}`)}
                </span>
                {current && step === 'runtime' && onInstallRuntime !== undefined && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={installing}
                    onClick={onInstallRuntime}
                  >
                    {installing ? t('simulatorSetupDownloading') : t('simulatorSetupDownload')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {/* The download is tens of minutes and many gigabytes, so say so before it is started
          rather than leaving a button that looks instant. */}
      {blocking === 'runtime' && (
        <p className="max-w-xs text-center text-muted-foreground text-xs">
          {t('simulatorSetupDownloadHint')}
        </p>
      )}
      {status.reason !== undefined && blocking === 'xcode' && (
        <p className="max-w-xs text-center text-muted-foreground text-xs">{status.reason}</p>
      )}
    </div>
  );
}

function StepIcon({ done }: { done: boolean }): React.ReactNode {
  if (done) return <CheckIcon className="mt-0.5 size-4 shrink-0 text-emerald-500" />;
  return <CircleDashedIcon className="mt-0.5 size-4 shrink-0" />;
}
