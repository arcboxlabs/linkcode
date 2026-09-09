import { HostClientGate } from '@mobile/components/host/host-client-gate';
import { NewThreadScreen } from '@mobile/components/host/new-thread/new-thread-screen';
import { VISIBLE_HEADER_OPTIONS } from '@mobile/components/shell/use-stack-screen-options';
import { useNativePalette } from '@mobile/components/theme/native-palette';
import { Stack } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Composer-first new-thread page, the mobile shape of the desktop draft surface: the start
 * options live inside the composer as menu chips — type the first message, send, and the thread
 * starts on the host with the prompt riding behind it. A root push, so it covers the tab bar. */
export default function NewThreadRoute(): React.ReactNode {
  const insets = useSafeAreaInsets();
  const palette = useNativePalette();

  return (
    <View
      className="flex-1"
      style={{ backgroundColor: palette.background, paddingBottom: insets.bottom }}
    >
      {/* Title-less on purpose: the composer says everything, and the bare back chevron keeps
          the page reading as a sheet of options rather than a destination. */}
      <Stack.Screen options={{ ...VISIBLE_HEADER_OPTIONS, title: '' }} />
      <HostClientGate>
        <NewThreadScreen />
      </HostClientGate>
    </View>
  );
}
