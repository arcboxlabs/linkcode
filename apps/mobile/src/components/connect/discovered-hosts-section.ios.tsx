import { HStack, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { accessibilityLabel, controlSize, foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { ManualHostRow } from '@mobile/components/connect/manual-host-row';
import { useDiscoveredHosts } from '@mobile/components/connect/use-discovered-hosts';
import { NavigationRow } from '@mobile/components/form/navigation-row';
import { useTranslations } from 'use-intl';

export function DiscoveredHostsSection(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const { discoveredHosts, status, saveAndOpen } = useDiscoveredHosts();

  return (
    <Section
      header={
        <HStack alignment="center" spacing={6}>
          <Text>{t('discovery.title')}</Text>
          {status === 'error' ? null : (
            <ProgressView
              modifiers={[controlSize('small'), accessibilityLabel(t('discovery.searching'))]}
            />
          )}
        </HStack>
      }
    >
      {status === 'error' ? (
        <Text modifiers={[foregroundStyle('red')]}>{t('discovery.error')}</Text>
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
    </Section>
  );
}
