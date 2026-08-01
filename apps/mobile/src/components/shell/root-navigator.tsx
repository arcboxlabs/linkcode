import { HostConnectionScope } from '@mobile/components/shell/host-connection-scope';
import { Stack } from 'expo-router';
import { useStackScreenOptions } from './use-stack-screen-options';

/** The app's root stack with theme-synced chrome; must sit under HeroUINativeProvider.
 * The connection wraps the stack, not a screen inside it, so switching tabs never redials. */
export function RootNavigator(): React.ReactNode {
  const screenOptions = useStackScreenOptions();
  return (
    <HostConnectionScope>
      <Stack screenOptions={screenOptions} />
    </HostConnectionScope>
  );
}
