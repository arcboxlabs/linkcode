/**
 * An online host owned by the signed-in cloud account, as returned by the HQ `GET /tunnel/hosts`
 * endpoint. A host appears here only while its daemon holds a live tunnel connection to the relay.
 */
export interface CloudHost {
  hostId: string;
  name: string | null;
  /** Epoch millis when the host's tunnel connection opened. */
  connectedAt: number;
  /** Epoch millis of the host's most recent activity on the tunnel. */
  lastSeen: number;
}

/**
 * Fetches the caller's online hosts. Injected by the app because the credential lives outside the
 * data plane — desktop reads the keychain session in its main process and exposes this over a bridge.
 */
export type CloudHostsSource = () => Promise<CloudHost[]>;
