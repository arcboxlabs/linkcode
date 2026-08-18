import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import type { LucideIcon } from 'lucide-react-native';
import { Pressable, Text } from 'react-native';

/** One composer tool on Android: a ghost chip that opens a bottom-sheet picker — the RN twin of
 * the iOS `OptionChip` UIMenu trigger, styled to match the composer footer it sits in. */
export function ToolChip({
  icon: Icon,
  label,
  value,
  iconOnly = false,
  maxValueWidth,
  onPress,
}: {
  /** Optional leading glyph; omit when an RN brand icon sits beside the chip instead. */
  icon?: LucideIcon;
  /** Accessibility name of the chip ("Model"); not rendered. */
  label: string;
  /** Resolved current value — rendered unless `iconOnly`, always spoken. */
  value: string;
  /** Icon-size the chip (the shield); the value still reaches accessibility. */
  iconOnly?: boolean;
  /** Cap for long values so one chip cannot push the send button out. */
  maxValueWidth?: number;
  onPress: () => void;
}): React.ReactNode {
  const colors = useAppMaterialColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onPress}
      className="flex-row items-center gap-1 px-1.5 py-2"
    >
      {Icon ? <Icon size={15} color={colors.onSurfaceVariant} /> : null}
      {iconOnly ? null : (
        <Text
          className="text-footnote"
          numberOfLines={1}
          style={{ color: colors.onSurfaceVariant, maxWidth: maxValueWidth }}
        >
          {value}
        </Text>
      )}
    </Pressable>
  );
}
