import { cloudAuthClient } from '@mobile/runtime/cloud/client';
import {
  applyMobileProductAnalyticsPreference,
  syncMobileProductAnalyticsIdentity,
} from '@mobile/runtime/product-analytics';
import {
  useAnalyticsPreferenceHydrated,
  useAnalyticsPreferenceStore,
} from '@mobile/stores/analytics-store';
import { useEffect } from 'react';

interface AnalyticsSessionState {
  data: { user: { id: string } } | null;
  isPending: boolean;
}
let analyticsIdentity: string | null | undefined;
cloudAuthClient.$store.atoms.session.subscribe((session: AnalyticsSessionState) => {
  if (session.isPending) return;
  const nextIdentity = session.data?.user.id ?? null;
  if (nextIdentity === analyticsIdentity) return;
  analyticsIdentity = nextIdentity;
  syncMobileProductAnalyticsIdentity(nextIdentity);
});

export function MobileProductAnalyticsProvider({
  children,
}: React.PropsWithChildren): React.ReactNode {
  return (
    <>
      <MobileProductAnalyticsLifecycle />
      {children}
    </>
  );
}

function MobileProductAnalyticsLifecycle(): null {
  const hydrated = useAnalyticsPreferenceHydrated();
  const enabled = useAnalyticsPreferenceStore((state) => state.enabled);

  useEffect(() => {
    if (hydrated) applyMobileProductAnalyticsPreference(enabled);
  }, [enabled, hydrated]);

  return null;
}
