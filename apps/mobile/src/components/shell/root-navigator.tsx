import { Stack } from 'expo-router';
import { useStackScreenOptions } from './use-stack-screen-options';

/** The app's root stack with theme-synced chrome; must sit under HeroUINativeProvider. */
export function RootNavigator(): React.ReactNode {
  const screenOptions = useStackScreenOptions();
  return <Stack screenOptions={screenOptions} />;
}
