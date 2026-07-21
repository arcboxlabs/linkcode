import type {
  Schedule,
  ScheduleId,
  ScheduleRun,
  ScheduleStatus,
  SessionId,
} from '@linkcode/schema';
import { deleteSchedule, pauseSchedule, resumeSchedule, runScheduleOnce } from '@linkcode/sdk';
import { useRelativeTimeLabel } from '@linkcode/ui';
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
import { Empty, EmptyDescription, EmptyTitle } from 'coss-ui/components/empty';
import { useTranslations } from 'use-intl';
import { useMutation } from '../runtime/tayori';
import { useScheduleRuns, useSchedules } from './hooks';
import { cadenceLabel } from './labels';

const STATUS_BADGE: Record<ScheduleStatus, 'success' | 'warning' | 'secondary'> = {
  active: 'success',
  paused: 'warning',
  completed: 'secondary',
};
const RUN_BADGE: Record<ScheduleRun['status'], 'success' | 'warning' | 'error' | 'secondary'> = {
  running: 'warning',
  succeeded: 'success',
  failed: 'error',
  skipped: 'secondary',
};

function absoluteTime(ts: number | undefined): string | undefined {
  return ts === undefined ? undefined : new Date(ts).toLocaleString();
}

export function ScheduleDetail({
  scheduleId,
  onOpenSession,
}: {
  scheduleId: ScheduleId;
  onOpenSession: (sessionId: SessionId) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const tAgent = useTranslations('workbench.agentKind');
  const { data: schedules } = useSchedules();
  const { data: runs } = useScheduleRuns(scheduleId);
  const pause = useMutation(pauseSchedule);
  const resume = useMutation(resumeSchedule);
  const runOnce = useMutation(runScheduleOnce);
  const remove = useMutation(deleteSchedule);

  const schedulesById = new Map(
    (schedules ?? []).map((schedule) => [schedule.scheduleId, schedule] as const),
  );
  const schedule = schedulesById.get(scheduleId);
  if (!schedule) {
    return (
      <Empty className="h-full">
        <EmptyTitle>{t('notFound')}</EmptyTitle>
      </Empty>
    );
  }

  const cadence = cadenceLabel(schedule.spec.cadence, t);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 truncate font-semibold text-lg">
            {schedule.spec.name ?? cadence}
          </h2>
          <Badge variant={STATUS_BADGE[schedule.status]}>{t(`status.${schedule.status}`)}</Badge>
        </div>
        <p className="whitespace-pre-wrap text-muted-foreground text-sm">{schedule.spec.prompt}</p>
      </header>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Fact label={t('schedule.cadenceLabel')} value={cadence} />
        <Fact label={t('schedule.target')} value={targetLabel(schedule, t)} />
        {schedule.spec.target.type === 'new-session' ? (
          <>
            <Fact label={t('agentLabel')} value={tAgent(schedule.spec.target.config.kind)} />
            <Fact label={t('cwdLabel')} value={schedule.spec.target.config.cwd} />
          </>
        ) : null}
        <TimeFact label={t('schedule.nextRun')} ts={schedule.nextRunAt} />
        <TimeFact label={t('schedule.lastRun')} ts={schedule.lastRunAt} />
      </dl>

      {schedule.status === 'completed' ? null : (
        <div className="flex flex-wrap gap-2">
          {schedule.status === 'active' ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void pause.trigger({ scheduleId });
              }}
            >
              {t('schedule.pause')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void resume.trigger({ scheduleId });
              }}
            >
              {t('schedule.resume')}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void runOnce.trigger({ scheduleId });
            }}
          >
            {t('schedule.runNow')}
          </Button>
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
                        void remove.trigger({ scheduleId });
                      }}
                    >
                      {t('delete')}
                    </Button>
                  }
                />
              </div>
            </AlertDialogPopup>
          </AlertDialog>
        </div>
      )}

      <section className="flex min-h-0 flex-col gap-2">
        <h3 className="font-medium text-sm">{t('schedule.runs')}</h3>
        {runs === undefined || runs.length === 0 ? (
          <Empty className="py-6">
            <EmptyDescription>{t('schedule.runsEmpty')}</EmptyDescription>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-1">
            {runs.map((run) => (
              <RunRow key={run.runId} run={run} onOpenSession={onOpenSession} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RunRow({
  run,
  onOpenSession,
}: {
  run: ScheduleRun;
  onOpenSession: (sessionId: SessionId) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const startedLabel = useRelativeTimeLabel(run.startedAt);
  const { sessionId } = run;
  return (
    <li className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
      <Badge variant={RUN_BADGE[run.status]}>{t(`schedule.runStatus.${run.status}`)}</Badge>
      <span className="text-muted-foreground text-xs" title={absoluteTime(run.startedAt)}>
        {startedLabel}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {run.error ?? run.summary ?? ''}
      </span>
      {sessionId ? (
        <Button size="sm" variant="ghost" onClick={() => onOpenSession(sessionId)}>
          {t('openThread')}
        </Button>
      ) : null}
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

/** A timestamp fact: live relative label, absolute time in the tooltip. */
function TimeFact({ label, ts }: { label: string; ts: number | undefined }): React.ReactNode {
  const relative = useRelativeTimeLabel(ts ?? 0);
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="truncate" title={absoluteTime(ts)}>
        {ts === undefined ? '—' : relative}
      </dd>
    </div>
  );
}

function targetLabel(schedule: Schedule, t: (key: string) => string): string {
  const target = schedule.spec.target;
  return target.type === 'new-session'
    ? t('schedule.targetNewSession')
    : t('schedule.targetSession');
}
