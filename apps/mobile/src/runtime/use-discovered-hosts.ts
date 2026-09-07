import { canonicalDirectHostUrl } from '@mobile/runtime/daemon-discovery';
import { useDaemonDiscovery } from '@mobile/runtime/use-daemon-discovery';
import { useOpenHost } from '@mobile/runtime/use-open-host';
import { useHostRegistryStore } from '@mobile/stores/host-store';

/** Discovered LAN daemons minus the ones already saved, plus the save-and-open action —
 * shared by both platform views of the discovered-hosts section. */
export function useDiscoveredHosts() {
  const { hosts, status } = useDaemonDiscovery();
  const openHost = useOpenHost();
  const savedHosts = useHostRegistryStore((state) => state.hosts);
  const addHost = useHostRegistryStore((state) => state.addHost);

  const savedUrls = new Set<string>();
  for (let i = 0, len = savedHosts.length; i < len; i++) {
    const host = savedHosts[i];
    if ('url' in host) savedUrls.add(canonicalDirectHostUrl(host.url));
  }
  const discoveredHosts = hosts.filter((host) => !savedUrls.has(canonicalDirectHostUrl(host.url)));

  const saveAndOpen = (host: (typeof discoveredHosts)[number]) => {
    const profile = addHost({ name: host.name, url: host.url });
    openHost(profile.id);
  };

  return { discoveredHosts, status, saveAndOpen };
}
