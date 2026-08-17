import { Host, LazyColumn } from '@expo/ui/jetpack-compose';

/** Android form scaffold — the Compose counterpart of the iOS `Host`+`Form` pair. The Host needs
 * the viewport as its proposed size or the column collapses to its content, same trap as SwiftUI.
 * LazyColumn maps each direct child to one lazy item, so keep children at section granularity. */
export function FormList({ children }: React.PropsWithChildren): React.ReactNode {
  return (
    <Host style={{ flex: 1 }} useViewportSizeMeasurement>
      <LazyColumn contentPadding={{ top: 8, bottom: 24 }}>{children}</LazyColumn>
    </Host>
  );
}
