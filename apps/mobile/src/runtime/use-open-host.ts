import { useHostRegistryStore } from '@mobile/stores/host-store';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

/** Enter the app pointed at a host. Selecting is the store write; the navigation only lands on the
 * tabs — which is why switching hosts later (from the header menu) needs the write alone. */
export function useOpenHost(): (hostId: string) => void {
  const router = useRouter();
  const setLastActiveHostId = useHostRegistryStore((state) => state.setLastActiveHostId);

  return useCallback(
    (hostId: string) => {
      setLastActiveHostId(hostId);
      router.push('/threads');
    },
    [router, setLastActiveHostId],
  );
}
