import { Button } from 'coss-ui/components/button';
import { SidebarFooter } from 'coss-ui/components/sidebar';
import { CircleArrowUpIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { systemBridge } from '../ipc';
import { useUpdaterState } from '../updater';

export function UpdateNotice(): React.ReactNode {
  const t = useTranslations('workbench.sidebar');
  const { status, version } = useUpdaterState();

  if (status !== 'downloaded' || !version) return null;

  const changelogUrl = `https://github.com/arcboxlabs/linkcode/releases/tag/${encodeURIComponent(`v${version}`)}`;

  return (
    <SidebarFooter className="shrink-0 px-2 pb-1">
      <div className="rounded-lg bg-sidebar-accent px-2.5 py-2">
        <div className="flex items-center gap-2">
          <CircleArrowUpIcon className="size-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="truncate font-medium text-xs">{t('updateReady')}</div>
            <div className="font-mono text-2xs text-label-tertiary">v{version}</div>
          </div>
        </div>
        <div className="mt-2 flex gap-1.5">
          <Button
            className="flex-1"
            size="xs"
            onClick={() => {
              void systemBridge.app.installUpdate();
            }}
          >
            {t('updateNow')}
          </Button>
          <Button
            className="flex-1"
            render={<a href={changelogUrl} rel="noreferrer" target="_blank" />}
            size="xs"
            variant="outline"
          >
            {t('changelog')}
          </Button>
        </div>
      </div>
    </SidebarFooter>
  );
}
