import { ensureDeviceRegistered } from '@mobile/runtime/cloud/devices';
import type { OnlineHost } from '@mobile/runtime/cloud/hosts';
import { fetchOnlineHosts } from '@mobile/runtime/cloud/hosts';
import { useOpenHost } from '@mobile/runtime/use-open-host';
import { useHostRegistryStore } from '@mobile/stores/host-store';
import { noop } from 'foxact/noop';
import { useCallback, useEffect, useState } from 'react';

export interface MyMachinesState {
  onlineHosts: OnlineHost[] | null;
  hostsError: boolean;
  refresh: () => void;
  saveAndOpen: (host: OnlineHost) => void;
}

/** Online machines (daemons connected to the relay), shared by both platform views. Tapping one
 * saves it as a tunnel host and opens it. */
export function useMyMachines(userId: string): MyMachinesState {
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

  return { onlineHosts, hostsError, refresh, saveAndOpen };
}
