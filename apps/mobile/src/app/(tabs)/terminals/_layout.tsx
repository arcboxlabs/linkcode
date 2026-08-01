import { HostClientGate } from '@mobile/components/host/host-client-gate';
import { useStackScreenOptions } from '@mobile/components/shell/use-stack-screen-options';
import { Stack } from 'expo-router';

export default function TerminalsTabLayout(): React.ReactNode {
  const screenOptions = useStackScreenOptions();

  return (
    <HostClientGate>
      <Stack screenOptions={screenOptions} />
    </HostClientGate>
  );
}
