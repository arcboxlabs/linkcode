import { Badge } from 'coss-ui/components/badge';
import { Card } from 'coss-ui/components/card';
import { Skeleton } from 'coss-ui/components/skeleton';
import { Switch } from 'coss-ui/components/switch';
import { createFixedArray } from 'foxact/create-fixed-array';
import { useTranslations } from 'use-intl';
import { AgentIcon } from '../../chat/agent-icon';
import { SettingsSection } from '../settings-page';
import type { SkillRowView } from './types';

const SKELETON_ROWS = createFixedArray(4);

export interface SkillsTabProps {
  /** Undefined while the first discovery is loading. */
  rows: SkillRowView[] | undefined;
  busy: boolean;
  searchQuery: string;
  /** Plugin-granularity toggle: no provider supports per-skill toggling. */
  onTogglePlugin: (row: SkillRowView, enabled: boolean) => void;
}

/** Plugin-bundled skills grouped by plugin, then standalone skills (display-only). */
export function SkillsTab({
  rows,
  busy,
  searchQuery,
  onTogglePlugin,
}: SkillsTabProps): React.ReactNode {
  const t = useTranslations('settings.plugins.skills');
  if (rows === undefined) {
    return (
      <div className="flex flex-col gap-2 pt-2">
        {SKELETON_ROWS.map((index) => (
          <Skeleton key={index} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }
  const needle = searchQuery.trim().toLowerCase();
  const visible = needle ? rows.filter((row) => row.searchText.includes(needle)) : rows;
  const pluginRows = visible.filter((row) => row.pluginKey !== undefined);
  const standaloneRows = visible.filter((row) => row.pluginKey === undefined);
  if (visible.length === 0) {
    return (
      <Card className="mt-2 px-4 py-4">
        <p className="text-muted-foreground text-sm">
          {needle ? t('noSearchResults') : t('empty')}
        </p>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-6 pt-2">
      {pluginRows.length === 0 ? null : (
        <SettingsSection title={t('pluginSkillsTitle')}>
          <Card className="divide-y divide-border">
            {pluginRows.map((row) => (
              <SkillRow key={row.key} row={row} busy={busy} onTogglePlugin={onTogglePlugin} />
            ))}
          </Card>
        </SettingsSection>
      )}
      {standaloneRows.length === 0 ? null : (
        <SettingsSection title={t('standaloneTitle')}>
          <p className="-mt-1 px-1 text-muted-foreground text-xs">{t('standaloneHint')}</p>
          <Card className="divide-y divide-border">
            {standaloneRows.map((row) => (
              <SkillRow key={row.key} row={row} busy={busy} onTogglePlugin={onTogglePlugin} />
            ))}
          </Card>
        </SettingsSection>
      )}
    </div>
  );
}

function SkillRow({
  row,
  busy,
  onTogglePlugin,
}: {
  row: SkillRowView;
  busy: boolean;
  onTogglePlugin: (row: SkillRowView, enabled: boolean) => void;
}): React.ReactNode {
  const t = useTranslations('settings.plugins.skills');
  const tScope = useTranslations('settings.plugins.scope');
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <AgentIcon kind={row.provider} className="size-4 shrink-0" />
          <span className="truncate font-medium text-sm">{row.name}</span>
          {row.pluginTitle === undefined ? null : (
            <span className="truncate text-label-tertiary text-xs">{row.pluginTitle}</span>
          )}
          {row.standaloneScope === undefined ? null : (
            <Badge variant="outline">{tScope(row.standaloneScope)}</Badge>
          )}
        </div>
        {row.description === undefined ? null : (
          <p className="line-clamp-1 text-muted-foreground text-xs">{row.description}</p>
        )}
        {row.canToggle && row.siblingSkillCount > 1 ? (
          <p className="text-2xs text-label-tertiary">
            {t('groupToggleNote', { count: row.siblingSkillCount })}
          </p>
        ) : null}
      </div>
      {row.canToggle ? (
        <Switch
          checked={row.enabled}
          disabled={busy}
          onCheckedChange={(checked) => onTogglePlugin(row, checked)}
        />
      ) : null}
    </div>
  );
}
