import type { RefreshControlProps } from 'react-native';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface ScreenScrollProps {
  /** Whether taps outside an open keyboard should be handled by children (forms). */
  keyboardAware?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- ScrollView's refreshControl prop requires react-native's own ReactElement<RefreshControlProps>; ReactNode does not satisfy it.
  refreshControl?: React.ReactElement<RefreshControlProps>;
  children: React.ReactNode;
}

/** Content container for top-level mobile screens under a native stack header:
 * safe-area-aware scroll view whose inset adjustment keeps iOS large titles collapsing.
 * Owns no routing or data — titles/actions live on the navigation header. */
export function ScreenScroll({
  keyboardAware,
  refreshControl,
  children,
}: ScreenScrollProps): React.ReactNode {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        padding: 20,
        paddingBottom: insets.bottom + 24,
        gap: 24,
      }}
      keyboardShouldPersistTaps={keyboardAware ? 'handled' : undefined}
      refreshControl={refreshControl}
    >
      {children}
    </ScrollView>
  );
}
