import { useStackScreenOptions } from '@mobile/components/shell/use-stack-screen-options';
import { Stack } from 'expo-router';

/** Deliberately ungated: this tab owns "Manage hosts", so it has to survive the host it is
 * hosted under being unreachable — otherwise a bad host address is unrecoverable from the app. */
export default function SettingsTabLayout(): React.ReactNode {
  const screenOptions = useStackScreenOptions({ softHeaderEdge: true });

  return <Stack screenOptions={screenOptions} />;
}
