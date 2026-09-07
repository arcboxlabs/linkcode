import { DropdownMenu, DropdownMenuItem, Text } from '@expo/ui/jetpack-compose';
import { combinedClickable, fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { useState } from 'react';
import { useAppMaterialColors } from './compose-theme.android';

export function RowActions({
  children,
  onPress,
  actions,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  actions: Array<{
    label: string;
    onPress: () => void;
    destructive?: boolean;
    disabled?: boolean;
  }>;
}): React.ReactNode {
  const [expanded, setExpanded] = useState(false);
  const colors = useAppMaterialColors();
  const openMenu = () => setExpanded(true);

  return (
    <DropdownMenu
      expanded={expanded}
      onDismissRequest={() => setExpanded(false)}
      modifiers={[
        fillMaxWidth(),
        combinedClickable({ onClick: onPress ?? openMenu, onLongClick: openMenu }),
      ]}
    >
      {children}
      <DropdownMenu.Items>
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            enabled={!action.disabled}
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
  );
}
