import { DropdownMenu, DropdownMenuItem, Icon, IconButton, Text } from '@expo/ui/jetpack-compose';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import type { HeaderMenuButtonProps } from '@mobile/components/shell/header-menu-button.types';
import { useState } from 'react';
import moreVertGlyph from '../../../assets/icons/more-vert.xml';

/** Android header overflow: an MD3 `DropdownMenu` anchored to its trigger — the Compose twin of
 * the iOS `UIMenu` bar item. The menu's trigger is fully controlled and the anchor is the
 * non-Items child, so the IconButton opens it explicitly. */
export function HeaderMenuButton({ label, actions }: HeaderMenuButtonProps): React.ReactNode {
  const [expanded, setExpanded] = useState(false);
  const colors = useAppMaterialColors();

  return (
    <ThemedHost matchContents>
      <DropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)}>
        <IconButton onClick={() => setExpanded(true)}>
          <Icon source={moreVertGlyph} contentDescription={label} tint={colors.onSurface} />
        </IconButton>
        <DropdownMenu.Items>
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.id}
              elementColors={action.destructive ? { textColor: colors.error } : undefined}
              onClick={() => {
                setExpanded(false);
                action.onPress();
              }}
            >
              <DropdownMenuItem.Text>
                <Text>{action.label}</Text>
              </DropdownMenuItem.Text>
            </DropdownMenuItem>
          ))}
        </DropdownMenu.Items>
      </DropdownMenu>
    </ThemedHost>
  );
}
