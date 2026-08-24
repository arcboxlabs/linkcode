import { ContainedLoadingIndicator, ListItem, Row, Switch, Text } from '@expo/ui/jetpack-compose';
import { fillMaxWidth, padding, toggleable } from '@expo/ui/jetpack-compose/modifiers';
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

/** Labeled switch row. The row owns the tap (`toggleable`), the Switch only displays the state —
 * giving it its own handler would double-toggle a tap that lands on the thumb. */
export function ToggleRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}): React.ReactNode {
  return (
    <ListItem modifiers={[toggleable(value, () => onValueChange(!value), { role: 'switch' })]}>
      <ListItem.HeadlineContent>
        <Text>{label}</Text>
      </ListItem.HeadlineContent>
      <ListItem.TrailingContent>
        <Switch value={value} />
      </ListItem.TrailingContent>
    </ListItem>
  );
}
