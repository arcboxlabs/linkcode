import type { ScheduleStatus, SessionId } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Empty, EmptyDescription, EmptyTitle } from 'coss-ui/components/empty';
import { Skeleton } from 'coss-ui/components/skeleton';
import { ClockIcon, PlusIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { useSchedules } from './hooks';
import { buildScheduleItems } from './items';
import { ScheduleDetail } from './schedule-detail';
import { ScheduleForm } from './schedule-form';
import { useAutomationsViewStore } from './store';

const STATUS_BADGE: Record<ScheduleStatus, 'success' | 'warning' | 'secondary'> = {
  active: 'success',
  paused: 'warning',
  completed: 'secondary',
};

/** The Automations management surface: a schedule master list beside a detail / create pane. */
export function AutomationsView({
  onOpenSession,
}: {
  onOpenSession: (sessionId: SessionId) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const { data: schedules, isLoading } = useSchedules();
  const view = useAutomationsViewStore((state) => state.view);
  const selectedScheduleId = useAutomationsViewStore((state) => state.selectedScheduleId);
  const select = useAutomationsViewStore((state) => state.select);
  const startCreate = useAutomationsViewStore((state) => state.startCreate);

  const items = buildScheduleItems(schedules);
  const activeId = selectedScheduleId ?? items[0]?.scheduleId ?? null;

  return (
    <div className="flex h-full min-h-0 gap-6 p-6">
      <div className="flex w-64 shrink-0 flex-col gap-3">
        <Button size="sm" onClick={startCreate}>
          <PlusIcon className="size-4" />
          {t('schedule.new')}
        </Button>
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {isLoading && items.length === 0 ? (
            <>
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </>
          ) : (
            items.map((item) => (
              <li key={item.scheduleId}>
                <button
                  type="button"
                  className={`flex w-full items-start gap-2 rounded-lg border p-2.5 text-left transition-colors ${
                    item.scheduleId === activeId && view.kind === 'browse'
                      ? 'border-border bg-muted'
                      : 'border-transparent hover:bg-muted/50'
                  }`}
                  onClick={() => select(item.scheduleId)}
                >
                  <ClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-sm">{item.name}</span>
                    <Badge variant={STATUS_BADGE[item.status]} className="mt-1">
                      {t(`status.${item.status}`)}
                    </Badge>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {view.kind === 'create-schedule' ? (
          <ScheduleForm />
        ) : activeId ? (
          <ScheduleDetail scheduleId={activeId} onOpenSession={onOpenSession} />
        ) : (
          <Empty className="h-full">
            <EmptyTitle>{t('empty')}</EmptyTitle>
            <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
          </Empty>
        )}
      </div>
    </div>
  );
}
