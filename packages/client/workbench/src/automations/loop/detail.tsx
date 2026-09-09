import type { LoopId, LoopIteration, LoopStatus, SessionId } from '@linkcode/schema';
import { TaskDisclosure, TaskLoadError } from '@linkcode/ui';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Empty, EmptyTitle } from 'coss-ui/components/empty';
import { useTranslations } from 'use-intl';
import { AutomationActions } from '../actions';
import { DetailHeaderPortal } from '../detail-header-slot';
import { AutomationPaneSkeleton } from '../pane-layout';
import { useLoopInspection, useLoopLog } from './hooks';
import { LoopLogView } from './log-view';

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
  const { data: inspection, error, mutate } = useLoopInspection(loopId);
  const logs = useLoopLog(loopId);

  if (!inspection) {
    if (error) {
      return (
        <TaskLoadError
          message={t('loadFailed')}
          retryLabel={t('retry')}
          onRetry={() => {
            void mutate();
          }}
        />
      );
    }
    return <AutomationPaneSkeleton />;
  }

  if (inspection.loop.loopId !== loopId) {
    return (
      <Empty className="h-full">
        <EmptyTitle>{t('notFound')}</EmptyTitle>
      </Empty>
    );
  }

  const { loop, iterations } = inspection;
  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      {error ? (
        <TaskLoadError
          message={t('loadFailed')}
          retryLabel={t('retry')}
          onRetry={() => {
            void mutate();
          }}
        />
      ) : null}
      <DetailHeaderPortal>
        <AutomationActions
          task={loop}
          sessionId={iterations.at(-1)?.workerSessionId}
          onOpenSession={onOpenSession}
        />
      </DetailHeaderPortal>
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Badge variant={STATUS_BADGE[loop.status]}>{t(`loopStatus.${loop.status}`)}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate font-semibold text-lg">
            {loop.spec.name ?? loop.spec.cwd}
          </h2>
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
      </dl>
      {loop.summary || loop.error ? (
        <p role="status" className="whitespace-pre-wrap break-words text-sm">
          {loop.status === 'failed'
            ? (iterations.at(-1)?.error ?? loop.error)
            : (loop.error ?? loop.summary)}
        </p>
      ) : null}

      <TaskDisclosure title={t('loop.log')}>
        <section className="flex flex-col gap-2">
          <LoopLogView entries={logs} emptyLabel={t('loop.logEmpty')} />
        </section>
      </TaskDisclosure>

      <TaskDisclosure title={t('loop.iterations')}>
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
      </TaskDisclosure>
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
            <li key={checkIndex} className="min-w-0 text-xs">
              <TaskDisclosure title={`${check.exitCode} · ${check.command}`}>
                {check.timedOut ? <p className="text-destructive">{t('loop.timedOut')}</p> : null}
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
                  {check.outputTail || t('loop.noOutput')}
                </pre>
              </TaskDisclosure>
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
      <dd className="truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}
