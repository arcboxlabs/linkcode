import { Text, TextButton } from '@expo/ui/jetpack-compose';
import { defaultMinSize, fillMaxWidth } from '@expo/ui/jetpack-compose/modifiers';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { NativeIconButton } from '@mobile/components/form/icon-button';
import { ThemedHost } from '@mobile/components/form/themed-host.android';

/** Native Material controls open the composer's model and approval sheets. */
export function ToolChip({
  label,
  value,
  iconOnly = false,
  maxValueWidth,
  onPress,
}: {
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

  if (iconOnly) {
    return <NativeIconButton icon="shield" label={`${label}: ${value}`} onPress={onPress} />;
  }

  return (
    <ThemedHost
      style={{ width: maxValueWidth }}
      matchContents={maxValueWidth ? { vertical: true } : true}
    >
      <TextButton
        onClick={onPress}
        colors={{ contentColor: colors.onSurfaceVariant }}
        modifiers={[defaultMinSize({ minHeight: 48 }), ...(maxValueWidth ? [fillMaxWidth()] : [])]}
      >
        <Text style={{ typography: 'labelMedium' }} maxLines={1} overflow="ellipsis">
          {value}
        </Text>
      </TextButton>
    </ThemedHost>
  );
}
