import { FilledIconButton, Icon, IconButton } from '@expo/ui/jetpack-compose';
import { size } from '@expo/ui/jetpack-compose/modifiers';
import arrowUp from '../../../assets/icons/arrow-up.xml';
import previous from '../../../assets/icons/chevron-left.xml';
import next from '../../../assets/icons/chevron-right.xml';
import close from '../../../assets/icons/close.xml';
import shield from '../../../assets/icons/shield.xml';
import stop from '../../../assets/icons/stop.xml';
import { useAppMaterialColors } from './compose-theme.android';
import type { NativeIconButtonProps } from './icon-button.types';
import { ThemedHost } from './themed-host.android';

const ICONS = { send: arrowUp, stop, close, previous, next, shield };

export function NativeIconButton({
  icon,
  label,
  onPress,
  disabled,
  filled,
}: NativeIconButtonProps): React.ReactNode {
  const Control = filled ? FilledIconButton : IconButton;
  const colors = useAppMaterialColors();
  return (
    <ThemedHost matchContents>
      <Control
        enabled={!disabled}
        onClick={onPress}
        modifiers={[size(48, 48)]}
        colors={filled ? undefined : { contentColor: colors.onSurfaceVariant }}
      >
        <Icon source={ICONS[icon]} size={24} contentDescription={label} />
      </Control>
    </ThemedHost>
  );
}
