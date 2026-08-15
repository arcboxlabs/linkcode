import { HostConnectionScope } from '@mobile/components/shell/host-connection-scope';
import { useMobileConfiguration } from '@mobile/runtime/config/use-mobile-configuration';
import { Stack } from 'expo-router';
import { useStackScreenOptions } from './use-stack-screen-options';

/** The app's root stack with theme-synced chrome; must sit under HeroUINativeProvider.
 * The connection wraps the stack, not a screen inside it, so switching tabs never redials. */
export function RootNavigator(): React.ReactNode {
  const configurationReady = useMobileConfiguration();
  const screenOptions = useStackScreenOptions();
  if (!configurationReady) return null;
  return (
    <HostConnectionScope>
      <Stack screenOptions={screenOptions} />
    </HostConnectionScope>
  );
}
