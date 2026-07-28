import { Stack } from 'expo-router';
import { useThemeColor } from 'heroui-native';
import type { LucideIcon } from 'lucide-react-native';
import { Pressable } from 'react-native';
import { useStackScreenOptions } from './use-stack-screen-options';

/** The app's root stack with theme-synced chrome; must sit under HeroUINativeProvider. */
export function RootNavigator(): React.ReactNode {
  const screenOptions = useStackScreenOptions();
  return <Stack screenOptions={screenOptions} />;
}

/** Icon-only tap target for navigation headers. */
export function HeaderIconButton({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  /** Accessibility label — icon buttons carry no visible text. */
  label: string;
  onPress: () => void;
}): React.ReactNode {
  const foreground = useThemeColor('foreground');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      className="h-9 w-9 items-center justify-center"
      style={({ pressed }) => ({ opacity: pressed ? 0.4 : 1 })}
    >
      <Icon size={21} color={foreground} strokeWidth={2} />
    </Pressable>
  );
}
