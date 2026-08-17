import { ListItem, Text } from '@expo/ui/jetpack-compose';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import type { CloudUser } from '@mobile/runtime/cloud/account';

/** Android profile row. No avatar: MD3 needs no placeholder glyph, and Apple sign-in supplies no
 * picture anyway (the iOS variant shows an SF Symbol for the same reason). */
export function ProfileRow({ user }: { user: CloudUser }): React.ReactNode {
  const colors = useAppMaterialColors();

  return (
    <ListItem>
      <ListItem.HeadlineContent>
        <Text style={{ typography: 'titleMedium' }}>{user.name || user.email}</Text>
      </ListItem.HeadlineContent>
      <ListItem.SupportingContent>
        <Text style={{ typography: 'bodySmall' }} color={colors.onSurfaceVariant}>
          {user.email}
        </Text>
      </ListItem.SupportingContent>
    </ListItem>
  );
}
