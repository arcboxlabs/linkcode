import { Button, Section, SwipeActions } from '@expo/ui/swift-ui';
import { NavigationRow } from '@mobile/components/form/navigation-row';
import { useOpenHost } from '@mobile/runtime/use-open-host';
import { useHostRegistryStore } from '@mobile/stores/host-store';
import { useTranslations } from 'use-intl';

/** Saved hosts, direct or tunnelled. Removal is the list's own swipe action rather than a
 *  row button, so the row itself stays a single tap target for opening the host. */
export function SavedHostsSection(): React.ReactNode {
  const t = useTranslations('mobile.connect');
  const openHost = useOpenHost();
  const hosts = useHostRegistryStore((state) => state.hosts);
  const removeHost = useHostRegistryStore((state) => state.removeHost);

  return (
    <Section title={t('savedHosts')}>
      {hosts.map((host) => (
        <SwipeActions key={host.id}>
          <SwipeActions.Actions>
            <Button role="destructive" label={t('remove')} onPress={() => removeHost(host.id)} />
          </SwipeActions.Actions>
          <NavigationRow
            title={host.name}
            subtitle={'url' in host ? host.url : t('viaTunnel')}
            onPress={() => openHost(host.id)}
          />
        </SwipeActions>
      ))}
    </Section>
  );
}
