import type { LoopId, ScheduleId, SessionId } from '@linkcode/schema';
import { cn, SHELL_TRANSITION, usePaneTransition } from '@linkcode/ui';
import { Button } from 'coss-ui/components/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from 'coss-ui/components/input-group';
import { Tabs, TabsList, TabsTab } from 'coss-ui/components/tabs';
import { useMediaQuery } from 'coss-ui/hooks/use-media-query';
import { PlusIcon, SearchIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { LoopDetail } from './loop/detail';
import { LoopForm } from './loop/form';
import { LoopPane } from './loop/pane';
import { AutomationCreatePane } from './pane-layout';
import { ScheduleDetail } from './schedule/detail';
import { ScheduleForm } from './schedule/form';
import { SchedulePane } from './schedule/pane';
import type { AutomationsPane, AutomationTab } from './store';
import { useAutomationsViewStore } from './store';

type AutomationDetailTarget =
  | { kind: 'create-schedule' }
  | { kind: 'create-loop' }
  | { kind: 'schedule'; scheduleId: ScheduleId }
  | { kind: 'loop'; loopId: LoopId };

/** The Automations management surface: a compact index that expands into master-detail on demand. */
export function AutomationsView({
  onOpenSession,
}: {
  onOpenSession: (sessionId: SessionId) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const tab = useAutomationsViewStore((state) => state.tab);
  const setTab = useAutomationsViewStore((state) => state.setTab);
  const view = useAutomationsViewStore((state) => state.view);
  const selectedScheduleId = useAutomationsViewStore((state) => state.selectedScheduleId);
  const selectedLoopId = useAutomationsViewStore((state) => state.selectedLoopId);
  const startCreate = useAutomationsViewStore((state) => state.startCreate);
  const startCreateLoop = useAutomationsViewStore((state) => state.startCreateLoop);
  const collapse = useAutomationsViewStore((state) => state.collapse);
  const [query, setQuery] = useState('');
  const creating = view.kind !== 'browse';
  const expanded =
    creating || (tab === 'schedules' ? selectedScheduleId !== null : selectedLoopId !== null);
  const splitLayout = useMediaQuery({ min: 1024 });
  const paneTransition = usePaneTransition({ open: expanded && splitLayout });
  const masterDetailVisible = splitLayout ? paneTransition.paneVisible : expanded;
  const startCurrentCreate = tab === 'schedules' ? startCreate : startCreateLoop;
  const createDisabled = view.kind === (tab === 'schedules' ? 'create-schedule' : 'create-loop');
  const createLabel = tab === 'schedules' ? t('schedule.new') : t('loop.new');
  const list = tab === 'schedules' ? <SchedulePane query={query} /> : <LoopPane query={query} />;
  const detailTarget = getAutomationDetailTarget({
    tab,
    view,
    selectedScheduleId,
    selectedLoopId,
  });
  const [renderedDetailTarget, setRenderedDetailTarget] = useState(detailTarget);
  if (
    detailTarget !== null &&
    detailTargetIdentity(detailTarget) !== detailTargetIdentity(renderedDetailTarget)
  ) {
    setRenderedDetailTarget(detailTarget);
  }

  let detail: React.ReactNode;
  switch (renderedDetailTarget?.kind) {
    case 'create-schedule': {
      detail = (
        <AutomationCreatePane
          title={t('schedule.new')}
          description={t('schedule.createDescription')}
        >
          <ScheduleForm />
        </AutomationCreatePane>
      );

      break;
    }
    case 'create-loop': {
      detail = (
        <AutomationCreatePane title={t('loop.new')} description={t('loop.createDescription')}>
          <LoopForm />
        </AutomationCreatePane>
      );

      break;
    }
    case 'schedule': {
      detail = (
        <ScheduleDetail
          scheduleId={renderedDetailTarget.scheduleId}
          onOpenSession={onOpenSession}
        />
      );

      break;
    }
    case 'loop': {
      detail = <LoopDetail loopId={renderedDetailTarget.loopId} onOpenSession={onOpenSession} />;

      break;
    }
    default: {
      detail = null;
    }
  }

  const handleTransitionRun = (event: React.TransitionEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || event.propertyName !== 'grid-template-columns') {
      return;
    }
    paneTransition.rearmFallback();
  };
  const handleTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget || event.propertyName !== 'grid-template-columns') {
      return;
    }
    paneTransition.settle();
  };

  return (
    <div
      className={cn(
        'grid h-full min-h-0 grid-cols-1 bg-background lg:[container-type:inline-size] lg:transition-[grid-template-columns] motion-reduce:transition-none',
        expanded ? 'lg:grid-cols-[22rem_calc(100%_-_22rem)]' : 'lg:grid-cols-[100%_0%]',
      )}
      style={{
        transitionDuration:
          splitLayout && paneTransition.isAnimating && !paneTransition.reducedMotion
            ? `${SHELL_TRANSITION.durationMs}ms`
            : '0ms',
        transitionTimingFunction: SHELL_TRANSITION.cssEase,
      }}
      onTransitionRun={handleTransitionRun}
      onTransitionEnd={handleTransitionEnd}
      onTransitionCancel={handleTransitionRun}
    >
      <section className="min-h-0 min-w-0 overflow-hidden">
        {masterDetailVisible ? (
          <div className="flex h-full min-h-0 w-full flex-col border-border border-b px-4 py-3 lg:w-[22rem] lg:border-r lg:border-b-0">
            <div className="flex shrink-0 items-center justify-between gap-2">
              <Tabs value={tab} onValueChange={(value) => setTab(value as AutomationTab)}>
                <TabsList>
                  <TabsTab value="schedules">{t('tabs.schedules')}</TabsTab>
                  <TabsTab value="loops">{t('tabs.loops')}</TabsTab>
                </TabsList>
              </Tabs>
              <Button
                size="icon-sm"
                disabled={createDisabled}
                aria-label={createLabel}
                onClick={startCurrentCreate}
              >
                <PlusIcon className="size-4" />
              </Button>
            </div>
            <AutomationSearch compact query={query} onQueryChange={setQuery} />
            {list}
          </div>
        ) : (
          <div className="h-full min-h-0 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-6 py-10 lg:py-16">
              <header className="flex shrink-0 items-start justify-between gap-6">
                <div className="min-w-0">
                  <h1 className="font-semibold text-3xl tracking-tight">{t('title')}</h1>
                  <p className="mt-2 text-muted-foreground text-sm">{t('description')}</p>
                </div>
                <Button size="sm" disabled={createDisabled} onClick={startCurrentCreate}>
                  <PlusIcon className="size-4" />
                  {createLabel}
                </Button>
              </header>
              <AutomationSearch query={query} onQueryChange={setQuery} />
              <div className="mt-5 shrink-0">
                <Tabs value={tab} onValueChange={(value) => setTab(value as AutomationTab)}>
                  <TabsList>
                    <TabsTab value="schedules">{t('tabs.schedules')}</TabsTab>
                    <TabsTab value="loops">{t('tabs.loops')}</TabsTab>
                  </TabsList>
                </Tabs>
              </div>
              <div className="mt-4 flex min-h-64 flex-1 flex-col border-border border-t">
                {list}
              </div>
            </div>
          </div>
        )}
      </section>
      {masterDetailVisible ? (
        <section
          aria-hidden={!expanded}
          inert={!expanded}
          className="relative min-h-0 min-w-0 overflow-hidden bg-background"
        >
          <div className="h-full min-h-0 w-full lg:w-[calc(100cqw_-_22rem)]">
            <Button
              className="absolute top-3 right-3 z-10"
              size="icon-sm"
              variant="ghost"
              aria-label={t('closeDetails')}
              onClick={collapse}
            >
              <XIcon className="size-4" />
            </Button>
            <div className="h-full min-h-0 overflow-y-auto px-6 py-8 pr-14 lg:px-10 lg:py-10 lg:pr-16">
              {detail}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function getAutomationDetailTarget({
  tab,
  view,
  selectedScheduleId,
  selectedLoopId,
}: {
  tab: AutomationTab;
  view: AutomationsPane;
  selectedScheduleId: ScheduleId | null;
  selectedLoopId: LoopId | null;
}): AutomationDetailTarget | null {
  if (view.kind === 'create-schedule' || view.kind === 'create-loop') return view;
  if (tab === 'schedules' && selectedScheduleId !== null) {
    return { kind: 'schedule', scheduleId: selectedScheduleId };
  }
  if (tab === 'loops' && selectedLoopId !== null) return { kind: 'loop', loopId: selectedLoopId };
  return null;
}

function detailTargetIdentity(target: AutomationDetailTarget | null): string | null {
  if (target === null) return null;
  if (target.kind === 'schedule') return `schedule:${target.scheduleId}`;
  if (target.kind === 'loop') return `loop:${target.loopId}`;
  return target.kind;
}

function AutomationSearch({
  compact = false,
  query,
  onQueryChange,
}: {
  compact?: boolean;
  query: string;
  onQueryChange: (query: string) => void;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  return (
    <InputGroup className={compact ? 'mt-3 shrink-0 shadow-none' : 'mt-8 shrink-0 shadow-none'}>
      <InputGroupAddon>
        <SearchIcon className="text-muted-foreground" />
      </InputGroupAddon>
      <InputGroupInput
        nativeInput
        type="search"
        aria-label={t('searchPlaceholder')}
        placeholder={t('searchPlaceholder')}
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
      />
    </InputGroup>
  );
}
