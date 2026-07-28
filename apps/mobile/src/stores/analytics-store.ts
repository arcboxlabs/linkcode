import { zodPersist } from '@linkcode/common/zustand';
import Storage from 'expo-sqlite/kv-store';
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { create } from 'zustand';
import { createJSONStorage } from 'zustand/middleware';

interface AnalyticsPreferenceState {
  enabled: boolean;
  lastIdentifiedUserId: string | null;
}

const PersistedPreferenceSchema = z
  .object({ enabled: z.boolean(), lastIdentifiedUserId: z.string().nullable() })
  .partial();

export const useAnalyticsPreferenceStore = create<AnalyticsPreferenceState>()(
  zodPersist<AnalyticsPreferenceState>((_set) => ({ enabled: false, lastIdentifiedUserId: null }), {
    name: 'linkcode.mobile.analytics-preference:v1',
    schema: PersistedPreferenceSchema,
    storage: createJSONStorage(() => Storage),
    partialize: (state) => ({
      enabled: state.enabled,
      lastIdentifiedUserId: state.lastIdentifiedUserId,
    }),
  }),
);

export function useAnalyticsPreferenceHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useAnalyticsPreferenceStore.persist.hasHydrated());
  useEffect(() => {
    const unsubscribe = useAnalyticsPreferenceStore.persist.onFinishHydration(() =>
      setHydrated(true),
    );
    if (useAnalyticsPreferenceStore.persist.hasHydrated()) {
      const timer = setTimeout(() => setHydrated(true), 0);
      return () => {
        clearTimeout(timer);
        unsubscribe();
      };
    }
    return unsubscribe;
  }, []);
  return hydrated;
}
