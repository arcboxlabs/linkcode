import type { ScheduleId, ScheduleRun, ScheduleStatus, SessionId } from '@linkcode/schema';
import { TaskLoadError, useRelativeTimeLabel } from '@linkcode/ui';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Empty, EmptyDescription, EmptyTitle } from 'coss-ui/components/empty';
import { Tabs, TabsList, TabsPanel, TabsTab } from 'coss-ui/components/tabs';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { AutomationActions } from '../actions';
import { DetailHeaderPortal } from '../detail-header-slot';
import { AutomationPaneSkeleton } from '../pane-layout';
import { ScheduleForm } from './form';
import { useScheduleRuns, useSchedules } from './hooks';

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
  const { data: schedules, error, mutate } = useSchedules();
  const { data: runs, error: runsError, mutate: refreshRuns } = useScheduleRuns(scheduleId);
  const current = new Map(schedules?.map((entry) => [entry.scheduleId, entry])).get(scheduleId);
  const [last, setLast] = useState(current);
  if (current && current !== last) setLast(current);
  const schedule = current ?? last;
  if (!schedule) {
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
    if (schedules === undefined) return <AutomationPaneSkeleton />;
    return (
      <Empty>
        <EmptyTitle>{t('notFound')}</EmptyTitle>
      </Empty>
    );
  }
  const sessionId =
    runs?.reduce<SessionId | undefined>((first, run) => first ?? run.sessionId, undefined) ??
    (schedule.spec.target.type === 'session' ? schedule.spec.target.sessionId : undefined);
  return (
    <div className="flex w-full flex-col gap-5">
      <header className="flex items-center gap-2">
        <Badge variant={STATUS_BADGE[schedule.status]}>{t(`status.${schedule.status}`)}</Badge>
      </header>
      {current ? (
        <DetailHeaderPortal>
          <AutomationActions task={current} sessionId={sessionId} onOpenSession={onOpenSession} />
        </DetailHeaderPortal>
      ) : null}
      <Tabs defaultValue="edit">
        <TabsList>
          <TabsTab value="edit">{t('schedule.editTab')}</TabsTab>
          <TabsTab value="runs">{t('schedule.runs')}</TabsTab>
        </TabsList>
        <TabsPanel value="edit" className="pt-4">
          <ScheduleForm schedule={schedule} missing={schedules !== undefined && !current} />
        </TabsPanel>
        <TabsPanel value="runs" className="flex flex-col gap-2 pt-4">
          {runsError ? (
            <TaskLoadError
              message={t('loadFailed')}
              retryLabel={t('retry')}
              onRetry={() => {
                void refreshRuns();
              }}
            />
          ) : null}

          <section className="flex min-h-0 flex-col gap-2">
            {runs === undefined ? (
              <AutomationPaneSkeleton />
            ) : runs.length === 0 ? (
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
        </TabsPanel>
      </Tabs>
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
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-muted-foreground">
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
