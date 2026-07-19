import { useLinkCodeClient } from '@linkcode/client-core';
import { listAssets } from '@linkcode/sdk';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { useData } from '../runtime/tayori';

/**
 * Managed-asset store status (CODE-111): wanted version and install state per asset. Every
 * `asset.settled` broadcast revalidates the snapshot.
 */
export function useAssets() {
  const client = useLinkCodeClient();
  const result = useData(listAssets, {});
  const { mutate } = result;

  useAbortableEffect(
    (signal) =>
      client.subscribeAssetSettled(() => {
        if (!signal.aborted) void mutate();
      }),
    [client, mutate],
  );

  return result;
}
