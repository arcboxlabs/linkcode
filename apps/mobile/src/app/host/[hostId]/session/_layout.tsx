import { HostClientGate } from '@mobile/components/host/host-client-gate';
import { useStackScreenOptions } from '@mobile/components/shell/use-stack-screen-options';
import { Stack } from 'expo-router';

/** Threads push over the tab bar rather than inside a tab, so the composer owns the bottom edge. */
export default function SessionLayout(): React.ReactNode {
  const screenOptions = useStackScreenOptions();

  return (
    <HostClientGate>
      <Stack screenOptions={screenOptions} />
    </HostClientGate>
  );
}
