import { Button, Host } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  disabled,
  frame,
  labelStyle,
} from '@expo/ui/swift-ui/modifiers';
import type { SFSymbol } from 'sf-symbols-typescript';
import type { NativeIconButtonProps } from './icon-button.types';

const ICONS = {
  send: 'arrow.up',
  stop: 'stop.fill',
  close: 'xmark',
  previous: 'chevron.left',
  next: 'chevron.right',
  shield: 'shield',
} as const satisfies Record<NativeIconButtonProps['icon'], SFSymbol>;

export function NativeIconButton({
  icon,
  label,
  onPress,
  disabled: isDisabled,
  filled,
}: NativeIconButtonProps): React.ReactNode {
  return (
    <Host matchContents>
      <Button
        label={label}
        systemImage={ICONS[icon]}
        onPress={onPress}
        modifiers={[
          labelStyle('iconOnly'),
          accessibilityLabel(label),
          buttonStyle(filled ? 'borderedProminent' : 'borderless'),
          disabled(isDisabled ?? false),
          frame({ minWidth: 44, minHeight: 44 }),
        ]}
      />
    </Host>
  );
}
