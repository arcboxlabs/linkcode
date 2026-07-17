import type { RefreshControlProps } from 'react-native';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface ScreenScrollProps {
  title: string;
  /** Rendered next to the title, e.g. a settings shortcut button. */
  headerRight?: React.ReactNode;
  /** Whether taps outside an open keyboard should be handled by children (forms). */
  keyboardAware?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-restricted-types -- ScrollView's refreshControl prop requires react-native's own ReactElement<RefreshControlProps>; ReactNode does not satisfy it.
  refreshControl?: React.ReactElement<RefreshControlProps>;
  children: React.ReactNode;
}

/** Screen chrome for top-level mobile screens: safe-area-aware scroll container + title row.
 * Owns no routing or data — screens pass already-translated strings and their own content. */
export function ScreenScroll({
  title,
  headerRight,
  keyboardAware,
  refreshControl,
  children,
}: ScreenScrollProps): React.ReactNode {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        padding: 24,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
        gap: 24,
      }}
      keyboardShouldPersistTaps={keyboardAware ? 'handled' : undefined}
      refreshControl={refreshControl}
    >
      {headerRight ? (
        <View className="flex-row items-center justify-between">
          <Text className="text-[24px] text-foreground" style={{ fontWeight: '600' }}>
            {title}
          </Text>
          {headerRight}
        </View>
      ) : (
        <Text className="text-[24px] text-foreground" style={{ fontWeight: '600' }}>
          {title}
        </Text>
      )}
      {children}
    </ScrollView>
  );
}
