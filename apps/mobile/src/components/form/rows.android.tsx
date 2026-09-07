import { ContainedLoadingIndicator, ListItem, Row, Switch, Text } from '@expo/ui/jetpack-compose';
import { alpha, fillMaxWidth, padding, toggleable } from '@expo/ui/jetpack-compose/modifiers';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';

/** Quiet in-section message row: empty states, hints, and errors. */
export function FormHint({
  tone = 'secondary',
  children,
}: {
  tone?: 'secondary' | 'error';
  children: string;
}): React.ReactNode {
  const colors = useAppMaterialColors();

  return (
    <Text
      style={{ typography: 'bodyMedium' }}
      color={tone === 'error' ? colors.error : colors.onSurfaceVariant}
      modifiers={[padding(16, 12, 16, 12)]}
    >
      {children}
    </Text>
  );
}

/** Centered in-section loading row, the `ProgressView` stand-in. Without `fillMaxWidth` the Row
 * wraps its content and the "centered" indicator sits at the start edge. The indicator carries
 * the refresh indicator's colors (`PullToRefreshDefaults`) so every load state reads as one. */
export function FormLoadingRow(): React.ReactNode {
  const colors = useAppMaterialColors();
  return (
    <Row horizontalArrangement="center" modifiers={[fillMaxWidth(), padding(16, 12, 16, 12)]}>
      <ContainedLoadingIndicator
        color={colors.primary}
        containerColor={colors.surfaceContainerHigh}
      />
    </Row>
  );
}

// Expo always installs the native Switch callback, so thumb taps do not reach the row handler.
export function ToggleRow({
  label,
  value,
  onValueChange,
  enabled = true,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  enabled?: boolean;
}): React.ReactNode {
  return (
    <ListItem
      modifiers={
        enabled ? [toggleable(value, () => onValueChange(!value), { role: 'switch' })] : []
      }
    >
      <ListItem.HeadlineContent>
        <Text modifiers={enabled ? [] : [alpha(0.38)]}>{label}</Text>
      </ListItem.HeadlineContent>
      <ListItem.TrailingContent>
        <Switch value={value} enabled={enabled} onCheckedChange={onValueChange} />
      </ListItem.TrailingContent>
    </ListItem>
  );
}
