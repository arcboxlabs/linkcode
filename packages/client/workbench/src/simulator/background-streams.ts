import type { SessionId, SimulatorStreamCodec } from '@linkcode/schema';
import { useEffect } from 'foxact/use-abortable-effect';
import type { SimulatorStreamClient } from './stream-registry';
import { acquireSimulatorStream, setSimulatorStreamOptions } from './stream-registry';

/**
 * Frame rate an open-but-hidden device runs at. Deliberately not zero: keeping the stream alive is
 * what makes switching tabs instant instead of a reconnect, but nothing is rendering the device, so
 * paying for a full-rate encode on the host would buy nothing.
 */
const BACKGROUND_FPS = 2;

/**
 * Hold a low-rate stream for every open-but-not-active device (CODE-421), so a thread can keep
 * several simulators live at once without four full-rate H.264 encodes running on the host.
 *
 * Only leases — it never subscribes to frames, because no hidden tab draws any.
 */
export function useBackgroundSimulatorStreams(
  client: SimulatorStreamClient,
  sessionId: SessionId | null,
  udids: readonly string[],
  scale: number,
  codec: SimulatorStreamCodec,
): void {
  // Joined so the effect keys on the device set itself, not the array's identity.
  const key = udids.join(' ');
  useEffect(() => {
    if (sessionId === null || key === '') return;
    const options = { fps: BACKGROUND_FPS, scale, codec };
    const leases = key.split(' ').map((udid) => {
      const lease = acquireSimulatorStream(client, udid, sessionId, options);
      // An already-running stream (this device was the active tab a moment ago) is retuned down
      // rather than left at the rate the visible tab needed.
      setSimulatorStreamOptions(client, udid, options);
      return lease;
    });
    return () => {
      for (let i = 0, len = leases.length; i < len; i++) {
        const lease = leases[i];
        lease.release();
      }
    };
  }, [client, sessionId, key, scale, codec]);
}
