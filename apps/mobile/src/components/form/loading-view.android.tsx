import { Box, PullToRefreshBox } from '@expo/ui/jetpack-compose';
import { fillMaxSize } from '@expo/ui/jetpack-compose/modifiers';
import { ThemedHost } from '@mobile/components/form/themed-host.android';

/** Full-screen load state: the real pull-to-refresh box held in its refreshing state, so first
 * load shows exactly the indicator a drag refresh shows, in the same place.
 * topCenter: expo-ui's indicator slot drops Compose's align (see thread-list.tsx). */
export function LoadingView(): React.ReactNode {
  return (
    <ThemedHost style={{ flex: 1 }} useViewportSizeMeasurement>
      <PullToRefreshBox isRefreshing contentAlignment="topCenter" modifiers={[fillMaxSize()]}>
        <Box modifiers={[fillMaxSize()]} />
      </PullToRefreshBox>
    </ThemedHost>
  );
}
