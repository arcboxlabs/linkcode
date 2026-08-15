import type { DiscoveredDaemon } from '@mobile/runtime/daemon-discovery';
import { toDiscoveredDaemon } from '@mobile/runtime/daemon-discovery';
import { useEvent } from 'expo';
import type {
  DaemonDiscoveryError,
  DaemonDiscoverySnapshot,
  DaemonDiscoveryStatus,
} from '../../modules/linkcode-daemon-discovery';
import LinkCodeDaemonDiscovery from '../../modules/linkcode-daemon-discovery';

const INITIAL_SNAPSHOT: DaemonDiscoverySnapshot = {
  status: 'searching',
  hosts: [],
};

export interface DaemonDiscoveryState {
  status: DaemonDiscoveryStatus;
  hosts: DiscoveredDaemon[];
  error?: DaemonDiscoveryError;
}

export function useDaemonDiscovery(): DaemonDiscoveryState {
  const snapshot = useEvent(LinkCodeDaemonDiscovery, 'onHostsChanged', INITIAL_SNAPSHOT);
  const hosts: DiscoveredDaemon[] = [];
  for (const nativeHost of snapshot.hosts) {
    const host = toDiscoveredDaemon(nativeHost);
    if (host) hosts.push(host);
  }

  return {
    status: snapshot.status,
    hosts,
    error: snapshot.error,
  };
}
