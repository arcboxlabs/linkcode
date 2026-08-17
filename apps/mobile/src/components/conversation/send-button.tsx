import { useThemeColor } from 'heroui-native';
import { ArrowUpIcon, SquareIcon } from 'lucide-react-native';
import { Pressable } from 'react-native';

/** The round send action shared by the conversation composer and the new-thread draft: one
 * circular button that morphs between send and stop, because a turn in flight is the only thing
 * the user wants to do to it. */
export function SendButton({
  isRunning,
  enabled,
  sendLabel,
  stopLabel,
  onSend,
  onStop,
}: {
  isRunning: boolean;
  enabled: boolean;
  sendLabel: string;
  stopLabel: string;
  onSend: () => void;
  onStop: () => void;
}): React.ReactNode {
  const [muted, background, foreground] = useThemeColor(['muted', 'background', 'foreground']);
  const ActionIcon = isRunning ? SquareIcon : ArrowUpIcon;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isRunning ? stopLabel : sendLabel}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={isRunning ? onStop : onSend}
      className="h-9 w-9 items-center justify-center rounded-full"
      style={({ pressed }) => ({
        backgroundColor: enabled ? foreground : muted,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <ActionIcon
        size={17}
        color={background}
        fill={isRunning ? background : 'transparent'}
        strokeWidth={2.5}
      />
    </Pressable>
  );
}
