import { useLinkCodeClient } from '@linkcode/client-core';
import { SettingsCard } from '@linkcode/ui';
import { Switch } from 'coss-ui/components/switch';
import { useEffect } from 'foxact/use-abortable-effect';
import { noop } from 'foxts/noop';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { useSimulatorConsent } from '../simulator/consent';

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
  const [available, setAvailable] = useState(false);

  useEffect(
    (signal) => {
      void client
        .simulatorStatus()
        .then((status) => {
          if (!signal.aborted) setAvailable(status.available);
        })
        // No simulator surface at all — leave the card hidden.
        .catch(noop);
    },
    [client],
  );

  if (!available) return null;

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
