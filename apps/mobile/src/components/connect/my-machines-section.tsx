import { Button, HStack, ProgressView, Section, Spacer, Text } from '@expo/ui/swift-ui';
import { buttonStyle, foregroundStyle } from '@expo/ui/swift-ui/modifiers';
import { NavigationRow } from '@mobile/components/form/navigation-row';
import { FOOTNOTE, SECONDARY } from '@mobile/components/form/styles';
import { ensureDeviceRegistered } from '@mobile/runtime/cloud/devices';
import type { OnlineHost } from '@mobile/runtime/cloud/hosts';
import { fetchOnlineHosts } from '@mobile/runtime/cloud/hosts';
import { useOpenHost } from '@mobile/runtime/use-open-host';
import { useHostRegistryStore } from '@mobile/stores/host-store';
import { noop } from 'foxact/noop';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';

/** Online machines (daemons connected to the relay) — tapping one saves it as a tunnel host and opens it. */
export function MyMachinesSection({ userId }: { userId: string }): React.ReactNode {
  const t = useTranslations('mobile.connect.cloud');
  const openHost = useOpenHost();
  const addTunnelHost = useHostRegistryStore((state) => state.addTunnelHost);

  const [onlineHosts, setOnlineHosts] = useState<OnlineHost[] | null>(null);
  const [hostsError, setHostsError] = useState(false);

  const load = useCallback(() => {
    fetchOnlineHosts()
      .then(setOnlineHosts)
      .catch(() => setHostsError(true));
  }, []);

  const refresh = () => {
    setHostsError(false);
    setOnlineHosts(null);
    load();
  };

  useEffect(() => {
    // Best-effort: registration only lists the phone under the account's
    // devices; discovering and connecting to hosts does not depend on it.
    ensureDeviceRegistered(userId).catch(noop);
    load();
  }, [userId, load]);

  const saveAndOpen = (host: OnlineHost) => {
    const profile = addTunnelHost({
      name: host.name ?? host.hostId.slice(0, 8),
      tunnelHostId: host.hostId,
    });
    openHost(profile.id);
  };

  return (
    // A titled Section can't also carry an action, so the header is drawn by hand —
    // footnote + secondary is what SwiftUI gives a plain `title` on iOS.
    <Section
      header={
        <HStack>
          <Text modifiers={[FOOTNOTE, SECONDARY]}>{t('machines')}</Text>
          <Spacer />
          <Button
            label={t('refresh')}
            onPress={refresh}
            modifiers={[buttonStyle('plain'), FOOTNOTE]}
          />
        </HStack>
      }
    >
      {hostsError ? (
        <Text modifiers={[foregroundStyle('red')]}>{t('error')}</Text>
      ) : onlineHosts === null ? (
        <ProgressView />
      ) : onlineHosts.length === 0 ? (
        <Text modifiers={[SECONDARY]}>{t('empty')}</Text>
      ) : (
        onlineHosts.map((host) => (
          <NavigationRow
            key={host.hostId}
            title={host.name ?? host.hostId.slice(0, 8)}
            subtitle={t('title')}
            onPress={() => saveAndOpen(host)}
          />
        ))
      )}
    </Section>
  );
}
