import { Host } from '@expo/ui/jetpack-compose';
import { useResolvedColorScheme } from '@mobile/components/theme/use-color-scheme';

/** `Host` pinned to the APP theme. A bare Host follows the system scheme, which diverges from
 * the RN surfaces the moment the in-app appearance preference overrides it — dark text on a
 * dark background. Android components must use this, never `Host` directly.
 *
 * Sizing to content needs `matchContents={{ vertical: true }}`, never bare `matchContents`: the
 * horizontal axis then measures Compose unbounded, so `fillMaxWidth()` no-ops and a `weight(1)`
 * child collapses to zero width (labels wrapping one character per line, text vanishing). */
export function ThemedHost(props: React.ComponentProps<typeof Host>): React.ReactNode {
  const colorScheme = useResolvedColorScheme();
  return <Host colorScheme={colorScheme} {...props} />;
}
