import { useStackScreenOptions } from '@mobile/components/shell/use-stack-screen-options';
import { Stack } from 'expo-router';

/** Ungated for the same reason as the threads tab: the screen gates its own body so the header
 * keeps carrying the host switcher when the host cannot be reached. */
export default function TerminalsTabLayout(): React.ReactNode {
  const screenOptions = useStackScreenOptions();

  return <Stack screenOptions={screenOptions} />;
}
