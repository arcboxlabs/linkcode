import { HostClientGate } from '@mobile/components/host/host-client-gate';
import { useStackScreenOptions } from '@mobile/components/shell/use-stack-screen-options';
import { Stack } from 'expo-router';

/** A terminal pushes over the tab bar rather than inside a tab, so the canvas owns the full height. */
export default function TerminalLayout(): React.ReactNode {
  const screenOptions = useStackScreenOptions();

  return (
    <HostClientGate>
      <Stack screenOptions={screenOptions} />
    </HostClientGate>
  );
}
