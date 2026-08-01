import { useStackScreenOptions } from '@mobile/components/shell/use-stack-screen-options';
import { Stack } from 'expo-router';

/** Ungated on purpose: the screen gates its own body so the header — and the host switcher in it —
 * survives the selected host being unreachable, which is exactly when you need to switch. */
export default function ThreadsTabLayout(): React.ReactNode {
  const screenOptions = useStackScreenOptions();

  return <Stack screenOptions={screenOptions} />;
}
