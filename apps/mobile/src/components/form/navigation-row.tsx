import { ListItem, Text } from '@expo/ui/jetpack-compose';
import { clickable } from '@expo/ui/jetpack-compose/modifiers';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import type { NavigationRowProps } from '@mobile/components/form/navigation-row.types';

/** Android form row that pushes a route: an MD3 `ListItem` whose whole-row ripple comes from
 * `clickable`. MD3 list rows draw no disclosure chevron, so none is drawn. The SwiftUI variant
 * lives in `navigation-row.ios.tsx`. */
export function NavigationRow({
  title,
  subtitle,
  badgeText,
  onPress,
}: NavigationRowProps): React.ReactNode {
  const colors = useAppMaterialColors();

  return (
    <ListItem modifiers={[clickable(onPress)]}>
      <ListItem.HeadlineContent>
        <Text>{title}</Text>
      </ListItem.HeadlineContent>
      {subtitle === undefined ? null : (
        <ListItem.SupportingContent>
          <Text style={{ typography: 'bodySmall' }} color={colors.onSurfaceVariant}>
            {subtitle}
          </Text>
        </ListItem.SupportingContent>
      )}
      {badgeText === undefined ? null : (
        <ListItem.TrailingContent>
          <Text style={{ typography: 'labelSmall' }} color={colors.onSurfaceVariant}>
            {badgeText}
          </Text>
        </ListItem.TrailingContent>
      )}
    </ListItem>
  );
}
