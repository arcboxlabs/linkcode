import { HStack, ProgressView, Section, Text } from '@expo/ui/swift-ui';
import { accessibilityLabel, controlSize, foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { ManualHostRow } from '@mobile/components/connect/manual-host-row';
import { NavigationRow } from '@mobile/components/form/navigation-row';
import { canonicalDirectHostUrl } from '@mobile/runtime/daemon-discovery';
import { useDaemonDiscovery } from '@mobile/runtime/use-daemon-discovery';
import { useOpenHost } from '@mobile/runtime/use-open-host';
import { useHostRegistryStore } from '@mobile/stores/host-store';
import { useTranslations } from 'use-intl';

export function DiscoveredHostsSection(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const { hosts, status } = useDaemonDiscovery();
  const openHost = useOpenHost();
  const savedHosts = useHostRegistryStore((state) => state.hosts);
  const addHost = useHostRegistryStore((state) => state.addHost);
  const savedUrls = new Set<string>();
  for (const host of savedHosts) {
    if ('url' in host) savedUrls.add(canonicalDirectHostUrl(host.url));
  }
  const discoveredHosts = hosts.filter((host) => !savedUrls.has(canonicalDirectHostUrl(host.url)));

  const saveAndOpen = (host: (typeof discoveredHosts)[number]) => {
    const profile = addHost({ name: host.name, url: host.url });
    openHost(profile.id);
  };

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
