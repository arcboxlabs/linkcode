import { Tabs, TabsList, TabsTab } from 'coss-ui/components/tabs';
import { useTranslations } from 'use-intl';
import { useAutomationsViewStore } from './store';

export function AutomationFilters(): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const tab = useAutomationsViewStore((state) => state.tab);
  const schedule = useAutomationsViewStore((state) => state.scheduleFilter);
  const loop = useAutomationsViewStore((state) => state.loopFilter);
  const setSchedule = useAutomationsViewStore((state) => state.setScheduleFilter);
  const setLoop = useAutomationsViewStore((state) => state.setLoopFilter);
  return (
    <Tabs
      className="mt-3 shrink-0"
      value={tab === 'schedules' ? schedule : loop}
      onValueChange={(value) => {
        if (
          tab === 'schedules' &&
          (value === 'all' || value === 'active' || value === 'paused' || value === 'completed')
        ) {
          setSchedule(value);
        }
        if (tab === 'loops' && (value === 'all' || value === 'running' || value === 'finished')) {
          setLoop(value);
        }
      }}
    >
      <TabsList className="w-full">
        <TabsTab value="all">{t('all')}</TabsTab>
        {tab === 'schedules' ? (
          <>
            <TabsTab value="active">{t('status.active')}</TabsTab>
            <TabsTab value="paused">{t('status.paused')}</TabsTab>
            <TabsTab value="completed">{t('status.completed')}</TabsTab>
          </>
        ) : (
          <>
            <TabsTab value="running">{t('loopStatus.running')}</TabsTab>
            <TabsTab value="finished">{t('finished')}</TabsTab>
          </>
        )}
      </TabsList>
    </Tabs>
  );
}
