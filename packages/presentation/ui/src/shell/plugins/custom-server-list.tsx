import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Card } from 'coss-ui/components/card';
import { Skeleton } from 'coss-ui/components/skeleton';
import { Switch } from 'coss-ui/components/switch';
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { AgentIcon } from '../../chat/agent-icon';
import { SettingsSection } from '../settings-page';
import type { CustomMcpServerRow, PluginMcpServerRow } from './types';

export interface CustomServerListProps {
  /** Undefined while the config read is loading. */
  rows: CustomMcpServerRow[] | undefined;
  busy: boolean;
  onAdd: () => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}

export function CustomServerList({
  rows,
  busy,
  onAdd,
  onEdit,
  onRemove,
  onToggle,
}: CustomServerListProps): React.ReactNode {
  const t = useTranslations('settings.plugins.mcp');
  return (
    <SettingsSection
      title={
        <span className="flex w-full items-center justify-between">
          {t('customTitle')}
          <Button variant="outline" size="sm" onClick={onAdd}>
            <PlusIcon className="size-4" />
            {t('add')}
          </Button>
        </span>
      }
    >
      <p className="-mt-1 px-1 text-muted-foreground text-xs">{t('customHint')}</p>
      {rows === undefined ? (
        <Card className="px-4 py-4">
          <Skeleton className="h-10 w-full rounded-lg" />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="px-4 py-4">
          <p className="text-muted-foreground text-sm">{t('empty')}</p>
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-sm">{row.name}</span>
                  <Badge variant="outline">{row.transport}</Badge>
                  {row.secretKeys.length === 0 ? null : (
                    <span className="text-2xs text-label-tertiary">
                      {t('secretCount', { count: row.secretKeys.length })}
                    </span>
                  )}
                </div>
                <span className="truncate font-mono text-label-tertiary text-xs">{row.detail}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Switch
                  checked={row.enabled}
                  disabled={busy}
                  onCheckedChange={(checked) => onToggle(row.id, checked)}
                />
                <Button
                  aria-label={t('edit')}
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onEdit(row.id)}
                >
                  <PencilIcon className="size-4" />
                </Button>
                <Button
                  aria-label={t('remove')}
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  onClick={() => onRemove(row.id)}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </Card>
      )}
    </SettingsSection>
  );
}

/** Read-only lower section: MCP servers bundled by installed plugins (managed on the Plugins tab). */
export function PluginProvidedServers({ rows }: { rows: PluginMcpServerRow[] }): React.ReactNode {
  const t = useTranslations('settings.plugins.mcp');
  if (rows.length === 0) return null;
  return (
    <SettingsSection title={t('pluginProvidedTitle')}>
      <p className="-mt-1 px-1 text-muted-foreground text-xs">{t('pluginProvidedHint')}</p>
      <Card className="divide-y divide-border">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <AgentIcon kind={row.provider} className="size-4 shrink-0" />
              <span className="truncate font-medium text-sm">{row.serverName}</span>
              <span className="truncate text-label-tertiary text-xs">{row.pluginTitle}</span>
            </div>
            <span
              className={`size-1.5 shrink-0 rounded-full ${row.enabled ? 'bg-success' : 'bg-muted-foreground/40'}`}
            />
          </div>
        ))}
      </Card>
    </SettingsSection>
  );
}
