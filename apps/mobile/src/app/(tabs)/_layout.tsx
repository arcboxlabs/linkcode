import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTranslations } from 'use-intl';

/** The app's three top-level surfaces. `NativeTabs` is a real `UITabBarController`, so the iOS 26
 * floating tab bar and its scroll-minimize behaviour come from UIKit rather than being drawn here.
 *
 * The tabs sit at the root and the host is a selection, not a parent route — switching hosts is a
 * store write that leaves the tab you are standing in alone. Detail screens (a thread, a terminal)
 * live outside this layout: react-native-screens exposes `tabBarHidden` only on the host, not per
 * pushed screen, so pushing them from the root stack is the only way to keep the bar off a
 * composer or a terminal canvas. */
export default function TabsLayout(): React.ReactNode {
  const tThreads = useTranslations('mobile.sessions');
  const tTerminals = useTranslations('mobile.terminals');
  const tSettings = useTranslations('mobile.settings');

  return (
    <NativeTabs>
      <NativeTabs.Trigger name="threads">
        <NativeTabs.Trigger.Icon sf="bubble.left.and.text.bubble.right" />
        <NativeTabs.Trigger.Label>{tThreads('title')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="terminals">
        <NativeTabs.Trigger.Icon sf="apple.terminal" />
        <NativeTabs.Trigger.Label>{tTerminals('title')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf="gearshape" />
        <NativeTabs.Trigger.Label>{tSettings('title')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
