import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Switch } from 'coss-ui/components/switch';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { SettingsCard } from '../settings-page';
import type { CustomServerCardView } from './types';
import { PluginCardSkeleton } from './unit-list';

/** User-imported MCP servers: enablement, removal, and the import entry point. */
export function CustomServerList({
  servers,
  emptyLabel,
  busy,
  onToggle,
  onRemove,
  onAdd,
}: {
  /** Undefined while config loads — renders as a skeleton. */
  servers: CustomServerCardView[] | undefined;
  emptyLabel: string;
  busy: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}): React.ReactNode {
  const t = useTranslations('settings.plugins');

  return (
    <div className="flex flex-col gap-3">
      <p className="px-1 text-muted-foreground text-xs">{t('customHint')}</p>
      <SettingsCard>
        {servers === undefined ? (
          <PluginCardSkeleton />
        ) : servers.length === 0 ? (
          <div className="px-4 py-4 text-muted-foreground text-sm">{emptyLabel}</div>
        ) : (
          servers.map((server) => (
            <div key={server.id} className="flex items-start justify-between gap-4 px-4 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-sm">{server.name}</p>
                  <Badge variant="outline">{server.transport}</Badge>
                </div>
                <p className="mt-0.5 truncate text-muted-foreground text-xs">{server.detail}</p>
                {server.secretKeys.length > 0 && (
                  <p className="mt-0.5 text-muted-foreground text-xs">
                    {t('customSecretKeys', { keys: server.secretKeys.join(', ') })}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Switch
                  aria-label={t('enabledLabel', { name: server.name })}
                  checked={server.enabled}
                  disabled={busy}
                  onCheckedChange={(enabled) => onToggle(server.id, enabled)}
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t('customRemove', { name: server.name })}
                  disabled={busy}
                  onClick={() => onRemove(server.id)}
                >
                  <Trash2Icon />
                </Button>
              </div>
            </div>
          ))
        )}
      </SettingsCard>
      <div>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onAdd}>
          <PlusIcon />
          {t('customAdd')}
        </Button>
      </div>
    </div>
  );
}
