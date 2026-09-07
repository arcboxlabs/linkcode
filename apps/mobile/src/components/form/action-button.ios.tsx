import { Button, Host, Text } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  frame,
} from '@expo/ui/swift-ui/modifiers';
import type { ActionButtonProps } from './action-button.types';

export function ActionButton({
  label,
  onPress,
  disabled = false,
  variant = 'primary',
  fullWidth = false,
}: ActionButtonProps): React.ReactNode {
  return (
    <Host matchContents={fullWidth ? { vertical: true } : true}>
      <Button
        onPress={onPress}
        role={variant === 'destructive' ? 'destructive' : 'default'}
        modifiers={[
          buttonStyle(
            variant === 'primary'
              ? 'borderedProminent'
              : variant === 'text'
                ? 'borderless'
                : 'bordered',
          ),
          controlSize('large'),
          disabledModifier(disabled),
        ]}
      >
        <Text
          modifiers={[
            frame({
              minHeight: variant === 'text' ? 44 : undefined,
              maxWidth: fullWidth ? Number.POSITIVE_INFINITY : undefined,
            }),
          ]}
        >
          {label}
        </Text>
      </Button>
    </Host>
  );
}
