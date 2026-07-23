import type { McpServer } from '@linkcode/schema';
import type { CustomServerCardView, PluginUnitCardView } from '@linkcode/ui';
import { PluginSettingsPanel } from '@linkcode/ui';
import { useSingleton } from 'foxact/use-singleton';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { CustomServerDialog } from './custom-server-dialog';
import { usePluginSettings } from './hooks';
import { customServerViews, pluginUnitViews } from './view';

/** A stable id for a newly imported custom server; the daemon keys config operations off it. */
function newCustomServerId(): string {
  return `custom-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Card list of MCP capability units: enablement toggle plus derived per-server status. */
export function PluginsSettingsPanel(): React.ReactNode {
  const t = useTranslations('settings.plugins');
  const { catalog, config, error, isMutating, save } = usePluginSettings();
  const [addOpen, setAddOpen] = useState(false);
  // Expiry cutoff pinned per mount: precise enough for a settings page, pure for the compiler.
  const now = useSingleton(() => Date.now());

  const units: PluginUnitCardView[] | undefined =
    catalog === undefined || config === undefined
      ? undefined
      : pluginUnitViews(catalog, config, now.current).map((unit) => ({
          id: unit.id,
          label: t(unit.labelKey),
          description: t(unit.descriptionKey),
          enabled: unit.enabled,
          status: unit.status,
          servers: unit.servers.map((server) => ({
            name: server.name,
            serviceLabel:
              server.service === undefined ? undefined : t(`serviceName.${server.service}`),
            status: server.status,
          })),
        }));

  const customServers: CustomServerCardView[] | undefined =
    config === undefined ? undefined : customServerViews(config);

  const handleEnabledChange = (unitId: string, enabled: boolean): void => {
    if (catalog === undefined || config === undefined) return;
    const id = catalog.find((descriptor) => descriptor.id === unitId)?.id;
    if (id === undefined) return;
    const next = [
      ...config.units.filter((unit) => (unit.unitId as string) !== unitId),
      { unitId: id, enabled },
    ];
    // A failed write surfaces through `error`; the switch reverts on the next config read.
    save({ units: next }).catch(noop);
  };

  const handleCustomToggle = (id: string, enabled: boolean): void => {
    save({ customServerOperations: [{ type: 'update', id, enabled }] }).catch(noop);
  };

  const handleCustomRemove = (id: string): void => {
    save({ customServerOperations: [{ type: 'remove', id }] }).catch(noop);
  };

  const handleCustomAdd = async (server: McpServer): Promise<void> => {
    await save({
      customServerOperations: [
        { type: 'add', server: { id: newCustomServerId(), enabled: true, server } },
      ],
    });
  };

  return (
    <>
      <PluginSettingsPanel
        units={units}
        customServers={customServers}
        error={error === undefined ? undefined : (extractErrorMessage(error) ?? 'Unknown error')}
        busy={isMutating}
        onEnabledChange={handleEnabledChange}
        onCustomToggle={handleCustomToggle}
        onCustomRemove={handleCustomRemove}
        onAddCustom={() => setAddOpen(true)}
      />
      <CustomServerDialog
        open={addOpen}
        busy={isMutating}
        onOpenChange={setAddOpen}
        onSubmit={handleCustomAdd}
      />
    </>
  );
}
