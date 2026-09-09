import type { DiscoveredDaemon } from '@mobile/runtime/daemon-discovery';
import { toDiscoveredDaemon } from '@mobile/runtime/daemon-discovery';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
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
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);
  useFocusEffect(
    useCallback(() => {
      setSnapshot(INITIAL_SNAPSHOT);
      const subscription = LinkCodeDaemonDiscovery.addListener('onHostsChanged', setSnapshot);
      return () => subscription.remove();
    }, []),
  );
  const hosts: DiscoveredDaemon[] = [];
  for (let i = 0, len = snapshot.hosts.length; i < len; i++) {
    const nativeHost = snapshot.hosts[i];
    const host = toDiscoveredDaemon(nativeHost);
    if (host) hosts.push(host);
  }

  return {
    status: snapshot.status,
    hosts,
    error: snapshot.error,
  };
}
