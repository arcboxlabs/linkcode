export interface LinkCodeDaemonDiscoveryModuleEvents {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Expo's NativeModule event contract uses arbitrary argument lists.
  [eventName: string]: (...args: any[]) => void;
  onHostsChanged: (event: DaemonDiscoverySnapshot) => void;
}

export type DaemonDiscoveryStatus = 'searching' | 'ready' | 'error';

export type DaemonDiscoveryError = 'permissionDenied' | 'unavailable' | 'failed';

export interface NativeDiscoveredDaemon {
  id: string;
  name: string;
  host: string;
  port: number;
}

export interface DaemonDiscoverySnapshot {
  status: DaemonDiscoveryStatus;
  hosts: NativeDiscoveredDaemon[];
  error?: DaemonDiscoveryError;
}
