import type { SessionId } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { Tabs, TabsList, TabsTab } from 'coss-ui/components/tabs';
import { PlusIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { LoopPane } from './loop/pane';
import { SchedulePane } from './schedule/pane';
import type { AutomationTab } from './store';
import { useAutomationsViewStore } from './store';

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
