import type { LoopId, LoopIteration, LoopStatus, SessionId } from '@linkcode/schema';
import { deleteLoop, stopLoop } from '@linkcode/sdk';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from 'coss-ui/components/alert-dialog';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Empty, EmptyTitle } from 'coss-ui/components/empty';
import { useTranslations } from 'use-intl';
import { useMutation } from '../runtime/tayori';
import { useLoopInspection, useLoopLog } from './hooks';
import { LoopLogView } from './loop-log-view';

const STATUS_BADGE: Record<LoopStatus, 'success' | 'warning' | 'error' | 'secondary'> = {
  running: 'warning',
  succeeded: 'success',
  failed: 'error',
  stopped: 'secondary',
};
const ITERATION_BADGE: Record<LoopIteration['status'], 'success' | 'warning' | 'error'> = {
  running: 'warning',
  passed: 'success',
  failed: 'error',
};

export function LoopDetail({
  loopId,
  onOpenSession,
}: {
  loopId: LoopId;
  onOpenSession: (sessionId: SessionId) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const tAgent = useTranslations('workbench.agentKind');
  const { data: inspection } = useLoopInspection(loopId);
  const logs = useLoopLog(loopId);
  const stop = useMutation(stopLoop);
  const remove = useMutation(deleteLoop);

  if (!inspection) {
    return (
      <Empty className="h-full">
        <EmptyTitle>{t('notFound')}</EmptyTitle>
      </Empty>
    );
  }

  const { loop, iterations } = inspection;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate font-semibold text-lg">
            {loop.spec.name ?? loop.spec.cwd}
          </h2>
          <Badge variant={STATUS_BADGE[loop.status]}>{t(`loopStatus.${loop.status}`)}</Badge>
        </div>
        <p className="whitespace-pre-wrap text-muted-foreground text-sm">{loop.spec.prompt}</p>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Fact label={t('agentLabel')} value={tAgent(loop.spec.kind)} />
        <Fact label={t('cwdLabel')} value={loop.spec.cwd} />
        <Fact
          label={t('loop.iterations')}
          value={`${loop.iterationCount} / ${loop.spec.maxIterations}`}
        />
        <Fact label={t('loop.summary')} value={loop.summary ?? loop.error ?? '—'} />
      </dl>

      <div className="flex flex-wrap gap-2">
        {loop.status === 'running' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void stop.trigger({ loopId });
            }}
          >
            {t('loop.stop')}
          </Button>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button size="sm" variant="ghost" className="text-destructive">
                  {t('delete')}
                </Button>
              }
            />
            <AlertDialogPopup>
              <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('deleteConfirmDescription')}</AlertDialogDescription>
              <div className="mt-4 flex justify-end gap-2">
                <AlertDialogClose render={<Button variant="ghost">{t('cancel')}</Button>} />
                <AlertDialogClose
                  render={
                    <Button
                      variant="destructive"
                      onClick={() => {
                        void remove.trigger({ loopId });
                      }}
                    >
                      {t('delete')}
                    </Button>
                  }
                />
              </div>
            </AlertDialogPopup>
          </AlertDialog>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-sm">{t('loop.log')}</h3>
        <LoopLogView entries={logs} emptyLabel={t('loop.logEmpty')} />
      </section>

      <section className="flex min-h-0 flex-col gap-2">
        <h3 className="font-medium text-sm">{t('loop.iterations')}</h3>
        {iterations.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('loop.iterationsEmpty')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {iterations.map((iteration) => (
              <IterationRow
                key={iteration.index}
                iteration={iteration}
                onOpenSession={onOpenSession}
                t={t}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function IterationRow({
  iteration,
  onOpenSession,
  t,
}: {
  iteration: LoopIteration;
  onOpenSession: (sessionId: SessionId) => void;
  t: (key: string, values?: Record<string, number>) => string;
}): React.ReactNode {
  const workerSessionId = iteration.workerSessionId;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium">
          {t('loop.iterationTitle', { index: iteration.index + 1 })}
        </span>
        <Badge variant={ITERATION_BADGE[iteration.status]}>
          {t(`loop.iterationStatus.${iteration.status}`)}
        </Badge>
        {workerSessionId ? (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => onOpenSession(workerSessionId)}
          >
            {t('loop.openWorker')}
          </Button>
        ) : null}
      </div>
      {iteration.checks.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {iteration.checks.map((check, checkIndex) => (
            // Checks are an append-only, never-reordered sequence per iteration; index is stable.
            // eslint-disable-next-line @eslint-react/no-array-index-key -- no natural id; order is fixed
            <li key={checkIndex} className="flex items-center gap-2 font-mono text-xs">
              <Badge variant={check.exitCode === 0 ? 'success' : 'error'}>{check.exitCode}</Badge>
              <span className="min-w-0 flex-1 truncate">{check.command}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {iteration.verdict ? (
        <p className="text-muted-foreground text-xs">
          <span className={iteration.verdict.passed ? 'text-success' : 'text-destructive'}>
            {iteration.verdict.passed ? t('loop.verdictPassed') : t('loop.verdictFailed')}
          </span>
          {' — '}
          {iteration.verdict.reason}
        </p>
      ) : null}
      {iteration.error ? <p className="text-destructive text-xs">{iteration.error}</p> : null}
    </li>
  );
}

function Fact({ label, value }: { label: string; value: string }): React.ReactNode {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
