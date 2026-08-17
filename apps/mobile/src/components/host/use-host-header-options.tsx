import { HostSwitcherButton } from '@mobile/components/host/host-switcher-button';
import { useHostMenuItems } from '@mobile/components/host/use-host-menu-items';
import type { NativeStackNavigationOptions } from 'expo-router';
import { Platform } from 'react-native';

/** The header's host switcher as stack-screen options: native bar items on iOS, a headerLeft
 * pressable opening a bottom sheet on Android — `unstable_headerLeftItems` is silently ignored
 * there. Spread into each tab's `Stack.Screen` options. */
export function useHostHeaderOptions(): Partial<NativeStackNavigationOptions> {
  const hostMenuItems = useHostMenuItems();

  if (Platform.OS === 'ios') {
    return { unstable_headerLeftItems: () => hostMenuItems };
  }
  return { headerLeft: () => <HostSwitcherButton /> };
}
