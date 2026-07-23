import type { PluginUnitCardView } from '@linkcode/ui';
import { PluginSettingsPanel } from '@linkcode/ui';
import { useSingleton } from 'foxact/use-singleton';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import { useTranslations } from 'use-intl';
import { usePluginSettings } from './hooks';
import { pluginUnitViews } from './view';

/** Card list of MCP capability units: enablement toggle plus derived per-server status. */
export function PluginsSettingsPanel(): React.ReactNode {
  const t = useTranslations('settings.plugins');
  const { catalog, config, error, isMutating, save } = usePluginSettings();
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

  return (
    <PluginSettingsPanel
      units={units}
      error={error === undefined ? undefined : (extractErrorMessage(error) ?? 'Unknown error')}
      busy={isMutating}
      onEnabledChange={handleEnabledChange}
    />
  );
}
