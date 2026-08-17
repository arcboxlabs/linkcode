import { USES_IOS_26_NAVIGATION } from '@mobile/components/shell/ios-26-navigation';
import { usePrimaryActions } from '@mobile/components/shell/primary-action';
import { PrimaryActionScope } from '@mobile/components/shell/primary-action-scope';
import { router, useSegments } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useTranslations } from 'use-intl';

/** The app's top-level surfaces. `NativeTabs` is a real `UITabBarController`, so the iOS 26
 * floating tab bar and its scroll-minimize behaviour come from UIKit rather than being drawn here.
 *
 * The tabs sit at the root and the host is a selection, not a parent route — switching hosts is a
 * store write that leaves the tab you are standing in alone. Detail screens (a thread, a terminal)
 * live outside this layout: react-native-screens exposes `tabBarHidden` only on the host, not per
 * pushed screen, so pushing them from the root stack is the only way to keep the bar off a
 * composer or a terminal canvas. */
export default function TabsLayout(): React.ReactNode {
  return (
    <PrimaryActionScope>
      <TabsNavigator />
    </PrimaryActionScope>
  );
}

function TabsNavigator(): React.ReactNode {
  const tThreads = useTranslations('mobile.sessions');
  const tTerminals = useTranslations('mobile.terminals');
  const actions = usePrimaryActions();
  // Runtime segments under this layout are ['(tabs)', '<tab>'] — wider than the untyped-routes
  // 1-tuple, hence `.at`. Before hydration fall back to home.
  const segments = useSegments();
  const focused = actions[segments.at(1) ?? 'threads'] ?? null;

  return (
    <NativeTabs>
      {/* `md` is the Android glyph — without it the converter leaves the icon undefined and the
          tab renders label-only; `sf` is never read there. */}
      <NativeTabs.Trigger name="threads">
        <NativeTabs.Trigger.Icon sf="bubble.left.and.text.bubble.right" md="chat" />
        <NativeTabs.Trigger.Label>{tThreads('title')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="terminals">
        <NativeTabs.Trigger.Icon sf="apple.terminal" md="terminal" />
        <NativeTabs.Trigger.Label>{tTerminals('title')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {/* iOS 26's separated tab-bar slot (the `search` role) carries the focused tab's primary
       * action: `disabled` keeps native selection prevented while tabPress still reaches JS. */}
      {USES_IOS_26_NAVIGATION ? (
        <NativeTabs.Trigger
          name="compose"
          role="search"
          disabled
          listeners={{
            tabPress() {
              if (focused) focused.onPress();
              else router.navigate('/threads');
            },
          }}
        >
          <NativeTabs.Trigger.Icon sf={focused?.sf ?? 'square.and.pencil'} />
          <NativeTabs.Trigger.Label>
            {focused?.label ?? tThreads('newThread')}
          </NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      ) : null}
    </NativeTabs>
  );
}
