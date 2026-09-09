import { Button, FilledTonalButton, Text, TextButton } from '@expo/ui/jetpack-compose';
import { defaultMinSize, fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import type { ActionButtonProps } from './action-button.types';
import { useAppMaterialColors } from './compose-theme.android';
import { ThemedHost } from './themed-host.android';

export function ActionButton({
  label,
  onPress,
  disabled = false,
  variant = 'primary',
  fullWidth = false,
}: ActionButtonProps): React.ReactNode {
  const colors = useAppMaterialColors();
  const Control =
    variant === 'text' ? TextButton : variant === 'primary' ? Button : FilledTonalButton;
  return (
    <ThemedHost matchContents={fullWidth ? { vertical: true } : true}>
      <Control
        onClick={onPress}
        enabled={!disabled}
        colors={
          variant === 'destructive'
            ? { containerColor: colors.errorContainer, contentColor: colors.onErrorContainer }
            : undefined
        }
        modifiers={[defaultMinSize({ minHeight: 48 }), ...(fullWidth ? [fillMaxWidth()] : [])]}
      >
        <Text>{label}</Text>
      </Control>
    </ThemedHost>
  );
}
