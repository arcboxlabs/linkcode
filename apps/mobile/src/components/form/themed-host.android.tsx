import { Host } from '@expo/ui/jetpack-compose';
import { useResolvedColorScheme } from '@mobile/components/form/compose-theme.android';

/** `Host` pinned to the APP theme. A bare Host follows the system scheme, which diverges from
 * the RN surfaces the moment the in-app appearance preference overrides it — dark text on a
 * dark background. Android components must use this, never `Host` directly. */
export function ThemedHost(props: React.ComponentProps<typeof Host>): React.ReactNode {
  const colorScheme = useResolvedColorScheme();
  return <Host colorScheme={colorScheme} {...props} />;
}
