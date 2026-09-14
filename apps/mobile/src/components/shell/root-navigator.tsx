import { HostConnectionScope } from '@mobile/components/shell/host-connection-scope';
import {
  useStackScreenOptions,
  VISIBLE_HEADER_OPTIONS,
} from '@mobile/components/shell/use-stack-screen-options';
import { useMobileConfiguration } from '@mobile/runtime/config/use-mobile-configuration';
import { Stack } from 'expo-router';

/** The app's root stack with theme-synced chrome; must sit under HeroUINativeProvider.
 * The connection wraps the stack, not a screen inside it, so switching tabs never redials. */
export function RootNavigator(): React.ReactNode {
  const configurationReady = useMobileConfiguration();
  const screenOptions = useStackScreenOptions();
  if (!configurationReady) return null;
  return (
    <HostConnectionScope>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen
          name="add-host"
          options={{
            ...VISIBLE_HEADER_OPTIONS,
            presentation: 'formSheet',
            sheetAllowedDetents: [1],
            sheetGrabberVisible: false,
            headerBackVisible: false,
            title: '',
          }}
        />
      </Stack>
    </HostConnectionScope>
  );
}
