import { useLinkCodeClient } from '@linkcode/client-core';
import { SettingsCard } from '@linkcode/ui';
import { Switch } from 'coss-ui/components/switch';
import { useTranslations } from 'use-intl';
import { useSimulatorConsent } from '../simulator/consent';
import { useSimulatorStatus } from '../simulator/status';

/**
 * The global simulator kill switch (CODE-420): one bit that refuses every simulator MCP tool,
 * whatever any individual device is set to. The panel's own manual control is unaffected — this
 * governs agents, not the user.
 *
 * Renders nothing on a host with no simulator support, where the whole surface is moot.
 */
export function SimulatorAgentAccessCard(): React.ReactNode {
  const t = useTranslations('settings.agents');
  const client = useLinkCodeClient();
  const consent = useSimulatorConsent(client);
  // No simulator surface at all (the probe rejects) reads as unavailable — leave the card hidden.
  const { data: status } = useSimulatorStatus(client);

  if (status?.available !== true) return null;

  return (
    <SettingsCard>
      <div className="flex items-center gap-3 px-3 py-3">
        <div className="min-w-0 flex-1">
          <span className="font-medium text-sm">{t('simulatorAccess')}</span>
          <p className="text-muted-foreground text-xs">{t('simulatorAccessHint')}</p>
        </div>
        <Switch
          aria-label={t('simulatorAccess')}
          checked={consent.agentToolsEnabled}
          onCheckedChange={consent.setAgentToolsEnabled}
        />
      </div>
    </SettingsCard>
  );
}
