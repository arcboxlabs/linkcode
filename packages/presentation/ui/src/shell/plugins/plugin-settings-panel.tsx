import { Alert, AlertDescription } from 'coss-ui/components/alert';
import { InputGroup, InputGroupAddon, InputGroupInput } from 'coss-ui/components/input-group';
import { Tabs, TabsList, TabsPanel, TabsTab } from 'coss-ui/components/tabs';
import { SearchIcon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { SettingsCard } from '../settings-page';
import { CustomServerList } from './custom-server-list';
import type { CustomServerCardView, PluginUnitCardView } from './types';
import { PluginUnitList } from './unit-list';

export interface PluginSettingsPanelProps {
  /** Undefined while catalog/config load — the cards render as skeletons. */
  units: PluginUnitCardView[] | undefined;
  /** User-imported servers; undefined while config loads. */
  customServers: CustomServerCardView[] | undefined;
  error?: string;
  busy: boolean;
  onEnabledChange: (unitId: string, enabled: boolean) => void;
  onCustomToggle: (id: string, enabled: boolean) => void;
  onCustomRemove: (id: string) => void;
  onAddCustom: () => void;
}

function matchesQuery(query: string, haystacks: Array<string | undefined>): boolean {
  return haystacks.some((value) => value?.toLowerCase().includes(query));
}

function TabCount({ count }: { count: number | undefined }): React.ReactNode {
  return count === undefined ? null : (
    <span className="text-muted-foreground text-xs tabular-nums">{count}</span>
  );
}

/** Plugin management panel: capability units, custom MCP servers, and skills, tab-filtered
 * with a shared client-side search. */
export function PluginSettingsPanel({
  units,
  customServers,
  error,
  busy,
  onEnabledChange,
  onCustomToggle,
  onCustomRemove,
  onAddCustom,
}: PluginSettingsPanelProps): React.ReactNode {
  const t = useTranslations('settings.plugins');
  const [query, setQuery] = useState('');

  const trimmed = query.trim().toLowerCase();
  const filteredUnits =
    trimmed === ''
      ? units
      : units?.filter((unit) =>
          matchesQuery(trimmed, [
            unit.label,
            unit.description,
            ...unit.servers.map((server) => server.name),
          ]),
        );
  const filteredCustom =
    trimmed === ''
      ? customServers
      : customServers?.filter((server) => matchesQuery(trimmed, [server.name, server.detail]));

  return (
    <div className="flex flex-col gap-5">
      <p className="text-muted-foreground text-sm">{t('hint')}</p>

      {error === undefined ? null : (
        <Alert variant="error">
          <TriangleAlertIcon />
          <AlertDescription>{t('loadError', { message: error })}</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="plugins">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTab value="plugins">
              {t('tabPlugins')}
              <TabCount count={units?.length} />
            </TabsTab>
            <TabsTab value="mcp">
              {t('tabMcp')}
              <TabCount count={customServers?.length} />
            </TabsTab>
            <TabsTab value="skills">
              {t('tabSkills')}
              <TabCount count={0} />
            </TabsTab>
          </TabsList>
          <InputGroup className="h-8 w-56 bg-background shadow-none">
            <InputGroupAddon>
              <SearchIcon className="text-muted-foreground" />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={t('searchPlaceholder')}
              nativeInput
              placeholder={t('searchPlaceholder')}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </InputGroup>
        </div>

        <TabsPanel value="plugins" className="pt-2">
          <PluginUnitList
            units={filteredUnits}
            emptyLabel={t('searchEmpty')}
            busy={busy}
            onEnabledChange={onEnabledChange}
          />
        </TabsPanel>
        <TabsPanel value="mcp" className="pt-2">
          <CustomServerList
            servers={filteredCustom}
            emptyLabel={trimmed === '' ? t('customEmpty') : t('searchEmpty')}
            busy={busy}
            onToggle={onCustomToggle}
            onRemove={onCustomRemove}
            onAdd={onAddCustom}
          />
        </TabsPanel>
        <TabsPanel value="skills" className="pt-2">
          <SettingsCard>
            <div className="px-4 py-4 text-muted-foreground text-sm">{t('skillsEmpty')}</div>
          </SettingsCard>
        </TabsPanel>
      </Tabs>
    </div>
  );
}
