import { LoadingIndicator } from '@expo/ui/jetpack-compose';
import { size } from '@expo/ui/jetpack-compose/modifiers';
import { ManualHostRow } from '@mobile/components/connect/manual-host-row';
import { useDiscoveredHosts } from '@mobile/components/connect/use-discovered-hosts';
import { NavigationRow } from '@mobile/components/form/navigation-row';
import { FormHint } from '@mobile/components/form/rows.android';
import { FormSection } from '@mobile/components/form/section.android';
import { useTranslations } from 'use-intl';

export function DiscoveredHostsSection(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const { discoveredHosts, status, saveAndOpen } = useDiscoveredHosts();

  return (
    <FormSection
      title={t('discovery.title')}
      trailing={status === 'error' ? undefined : <LoadingIndicator modifiers={[size(16, 16)]} />}
    >
      {status === 'error' ? (
        <FormHint tone="error">{t('discovery.error')}</FormHint>
      ) : (
        discoveredHosts.map((host) => (
          <NavigationRow
            key={host.id}
            title={host.name}
            subtitle={host.url}
            onPress={() => saveAndOpen(host)}
          />
        ))
      )}
      <ManualHostRow />
    </FormSection>
  );
}
