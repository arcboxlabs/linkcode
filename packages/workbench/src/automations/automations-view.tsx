import type { LoopStatus, ScheduleStatus, SessionId } from '@linkcode/schema';
import { useRelativeTimeLabel } from '@linkcode/ui';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from 'coss-ui/components/empty';
import { Skeleton } from 'coss-ui/components/skeleton';
import { Tabs, TabsList, TabsTab } from 'coss-ui/components/tabs';
import { createFixedArray } from 'foxts/create-fixed-array';
import { ClockIcon, PlusIcon, RepeatIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { useLoops, useSchedules } from './hooks';
import type { AutomationListItem } from './items';
import { buildScheduleItems } from './items';
import { cadenceLabel } from './labels';
import { LoopDetail } from './loop-detail';
import { LoopForm } from './loop-form';
import type { LoopListItem } from './loop-items';
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
  const view = useAutomationsViewStore((state) => state.view);
  const startCreate = useAutomationsViewStore((state) => state.startCreate);
  const startCreateLoop = useAutomationsViewStore((state) => state.startCreateLoop);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-6 pt-4">
        <div className="flex shrink-0 items-center justify-between gap-2">
          <Tabs value={tab} onValueChange={(value) => setTab(value as AutomationTab)}>
            <TabsList>
              <TabsTab value="schedules">{t('tabs.schedules')}</TabsTab>
              <TabsTab value="loops">{t('tabs.loops')}</TabsTab>
            </TabsList>
          </Tabs>
          {tab === 'schedules' ? (
            <Button size="sm" disabled={view.kind === 'create-schedule'} onClick={startCreate}>
              <PlusIcon className="size-4" />
              {t('schedule.new')}
            </Button>
          ) : (
            <Button size="sm" disabled={view.kind === 'create-loop'} onClick={startCreateLoop}>
              <PlusIcon className="size-4" />
              {t('loop.new')}
            </Button>
          )}
        </div>
        {tab === 'schedules' ? (
          <SchedulePane onOpenSession={onOpenSession} />
        ) : (
          <LoopPane onOpenSession={onOpenSession} />
        )}
      </div>
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

  if (view.kind === 'create-schedule') {
    return (
      <CreatePane title={t('schedule.new')} description={t('schedule.createDescription')}>
        <ScheduleForm />
      </CreatePane>
    );
  }

  const items = buildScheduleItems(schedules);

  if (items.length === 0) {
    if (isLoading) return <PaneSkeleton />;
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClockIcon />
          </EmptyMedia>
          <EmptyTitle>{t('schedule.empty')}</EmptyTitle>
          <EmptyDescription>{t('schedule.emptyDescription')}</EmptyDescription>
        </EmptyHeader>
        <Button onClick={startCreate}>
          <PlusIcon className="size-4" />
          {t('schedule.new')}
        </Button>
      </Empty>
    );
  }

  const activeId = selectedScheduleId ?? items[0].scheduleId;
  return (
    <div className="flex min-h-0 flex-1 gap-6 py-4">
      <ul className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto">
        {items.map((item) => (
          <li key={item.scheduleId}>
            <ScheduleRow
              item={item}
              active={item.scheduleId === activeId}
              onSelect={() => select(item.scheduleId)}
            />
          </li>
        ))}
      </ul>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-2">
        <ScheduleDetail scheduleId={activeId} onOpenSession={onOpenSession} />
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

  if (view.kind === 'create-loop') {
    return (
      <CreatePane title={t('loop.new')} description={t('loop.createDescription')}>
        <LoopForm />
      </CreatePane>
    );
  }

  const items = buildLoopItems(loops);

  if (items.length === 0) {
    if (isLoading) return <PaneSkeleton />;
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RepeatIcon />
          </EmptyMedia>
          <EmptyTitle>{t('loop.empty')}</EmptyTitle>
          <EmptyDescription>{t('loop.emptyDescription')}</EmptyDescription>
        </EmptyHeader>
        <Button onClick={startCreateLoop}>
          <PlusIcon className="size-4" />
          {t('loop.new')}
        </Button>
      </Empty>
    );
  }

  const activeId = selectedLoopId ?? items[0].loopId;
  return (
    <div className="flex min-h-0 flex-1 gap-6 py-4">
      <ul className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto">
        {items.map((item) => (
          <li key={item.loopId}>
            <LoopRow
              item={item}
              active={item.loopId === activeId}
              onSelect={() => selectLoop(item.loopId)}
            />
          </li>
        ))}
      </ul>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto pb-2">
        <LoopDetail loopId={activeId} onOpenSession={onOpenSession} />
      </div>
    </div>
  );
}

/** A schedule list row; a component of its own for the live next-run clock. */
function ScheduleRow({
  item,
  active,
  onSelect,
}: {
  item: AutomationListItem;
  active: boolean;
  onSelect: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const nextRunLabel = useRelativeTimeLabel(item.nextRunAt ?? 0);
  const cadence = cadenceLabel(item.cadence, t);
  const subtitle =
    item.status === 'active' && item.nextRunAt !== undefined
      ? `${cadence} · ${nextRunLabel}`
      : cadence;

  return (
    <MasterButton
      active={active}
      onClick={onSelect}
      icon={<ClockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      name={item.name}
      subtitle={subtitle}
      badge={<Badge variant={SCHEDULE_BADGE[item.status]}>{t(`status.${item.status}`)}</Badge>}
    />
  );
}

function LoopRow({
  item,
  active,
  onSelect,
}: {
  item: LoopListItem;
  active: boolean;
  onSelect: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  return (
    <MasterButton
      active={active}
      onClick={onSelect}
      icon={<RepeatIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
      name={item.name}
      subtitle={t('loop.iterationProgress', {
        count: item.iterationCount,
        max: item.maxIterations,
      })}
      badge={<Badge variant={LOOP_BADGE[item.status]}>{t(`loopStatus.${item.status}`)}</Badge>}
    />
  );
}

/** The create form's full-pane wrapper: centered column with a heading. */
function CreatePane({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-6">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h2 className="font-semibold text-lg">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </header>
        {children}
      </div>
    </div>
  );
}

function MasterButton({
  active,
  onClick,
  icon,
  name,
  subtitle,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  name: string;
  subtitle: string;
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
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-sm">{name}</span>
          {badge}
        </span>
        <span className="block truncate text-muted-foreground text-xs">{subtitle}</span>
      </span>
    </button>
  );
}

function PaneSkeleton(): React.ReactNode {
  return (
    <div className="flex min-h-0 flex-1 gap-6 py-4">
      <div className="flex w-64 shrink-0 flex-col gap-1">
        {createFixedArray(3).map((index) => (
          <Skeleton key={index} className="h-14 w-full rounded-lg" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Skeleton className="h-6 w-56 rounded-md" />
        <Skeleton className="h-4 w-80 rounded-md" />
      </div>
    </div>
  );
}
