import { LazyColumn } from '@expo/ui/jetpack-compose';
import { ThemedHost } from '@mobile/components/form/themed-host.android';

/** Android form scaffold — the Compose counterpart of the iOS `Host`+`Form` pair. The Host needs
 * the viewport as its proposed size or the column collapses to its content, same trap as SwiftUI.
 * LazyColumn maps each direct child to one lazy item, so keep children at section granularity. */
export function FormList({ children }: React.PropsWithChildren): React.ReactNode {
  return (
    <ThemedHost style={{ flex: 1 }} useViewportSizeMeasurement>
      <LazyColumn contentPadding={{ top: 8, bottom: 24 }}>{children}</LazyColumn>
    </ThemedHost>
  );
}
