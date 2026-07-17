import type { LoopStatus, ScheduleStatus, SessionId } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Empty, EmptyDescription, EmptyTitle } from 'coss-ui/components/empty';
import { Skeleton } from 'coss-ui/components/skeleton';
import { Tabs, TabsList, TabsTab } from 'coss-ui/components/tabs';
import { ClockIcon, PlusIcon, RepeatIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { useLoops, useSchedules } from './hooks';
import { buildScheduleItems } from './items';
import { LoopDetail } from './loop-detail';
import { LoopForm } from './loop-form';
import { buildLoopItems } from './loop-items';
import { ScheduleDetail } from './schedule-detail';
import { ScheduleForm } from './schedule-form';
import type { AutomationTab } from './store';
import { useAutomationsViewStore } from './store';

const SCHEDULE_BADGE: Record<ScheduleStatus, 'success' | 'warning' | 'secondary'> = {
  active: 'success',
  paused: 'warning',
  completed: 'secondary',
};
const LOOP_BADGE: Record<LoopStatus, 'success' | 'warning' | 'error' | 'secondary'> = {
  running: 'warning',
  succeeded: 'success',
  failed: 'error',
  stopped: 'secondary',
};

/** The Automations management surface: a Schedules / Loops tab switcher over a master-detail pane. */
export function AutomationsView({
  onOpenSession,
}: {
  onOpenSession: (sessionId: SessionId) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const tab = useAutomationsViewStore((state) => state.tab);
  const setTab = useAutomationsViewStore((state) => state.setTab);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-6 pt-4">
        <Tabs value={tab} onValueChange={(value) => setTab(value as AutomationTab)}>
          <TabsList>
            <TabsTab value="schedules">{t('tabs.schedules')}</TabsTab>
            <TabsTab value="loops">{t('tabs.loops')}</TabsTab>
          </TabsList>
        </Tabs>
      </div>
      {tab === 'schedules' ? (
        <SchedulePane onOpenSession={onOpenSession} />
      ) : (
        <LoopPane onOpenSession={onOpenSession} />
      )}
    </div>
  );
}

function SchedulePane({
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
    <div className="flex min-h-0 flex-1 gap-6 p-6">
      <div className="flex w-64 shrink-0 flex-col gap-3">
        <Button size="sm" onClick={startCreate}>
          <PlusIcon className="size-4" />
          {t('schedule.new')}
        </Button>
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {isLoading && items.length === 0 ? (
            <ListSkeleton />
          ) : (
            items.map((item) => (
              <li key={item.scheduleId}>
                <MasterButton
                  active={item.scheduleId === activeId && view.kind === 'browse'}
                  onClick={() => select(item.scheduleId)}
                  icon={<ClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  name={item.name}
                  badge={
                    <Badge variant={SCHEDULE_BADGE[item.status]} className="mt-1">
                      {t(`status.${item.status}`)}
                    </Badge>
                  }
                />
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

function LoopPane({
  onOpenSession,
}: {
  onOpenSession: (sessionId: SessionId) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const { data: loops, isLoading } = useLoops();
  const view = useAutomationsViewStore((state) => state.view);
  const selectedLoopId = useAutomationsViewStore((state) => state.selectedLoopId);
  const selectLoop = useAutomationsViewStore((state) => state.selectLoop);
  const startCreateLoop = useAutomationsViewStore((state) => state.startCreateLoop);

  const items = buildLoopItems(loops);
  const activeId = selectedLoopId ?? items[0]?.loopId ?? null;

  return (
    <div className="flex min-h-0 flex-1 gap-6 p-6">
      <div className="flex w-64 shrink-0 flex-col gap-3">
        <Button size="sm" onClick={startCreateLoop}>
          <PlusIcon className="size-4" />
          {t('loop.new')}
        </Button>
        <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {isLoading && items.length === 0 ? (
            <ListSkeleton />
          ) : (
            items.map((item) => (
              <li key={item.loopId}>
                <MasterButton
                  active={item.loopId === activeId && view.kind === 'browse'}
                  onClick={() => selectLoop(item.loopId)}
                  icon={<RepeatIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                  name={item.name}
                  badge={
                    <Badge variant={LOOP_BADGE[item.status]} className="mt-1">
                      {t(`loopStatus.${item.status}`)}
                    </Badge>
                  }
                />
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {view.kind === 'create-loop' ? (
          <LoopForm />
        ) : activeId ? (
          <LoopDetail loopId={activeId} onOpenSession={onOpenSession} />
        ) : (
          <Empty className="h-full">
            <EmptyTitle>{t('loop.empty')}</EmptyTitle>
            <EmptyDescription>{t('loop.emptyDescription')}</EmptyDescription>
          </Empty>
        )}
      </div>
    </div>
  );
}

function MasterButton({
  active,
  onClick,
  icon,
  name,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  name: string;
  badge: React.ReactNode;
}): React.ReactNode {
  return (
    <button
      type="button"
      className={`flex w-full items-start gap-2 rounded-lg border p-2.5 text-left transition-colors ${
        active ? 'border-border bg-muted' : 'border-transparent hover:bg-muted/50'
      }`}
      onClick={onClick}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-sm">{name}</span>
        {badge}
      </span>
    </button>
  );
}

function ListSkeleton(): React.ReactNode {
  return (
    <>
      <Skeleton className="h-12 w-full rounded-lg" />
      <Skeleton className="h-12 w-full rounded-lg" />
    </>
  );
}
