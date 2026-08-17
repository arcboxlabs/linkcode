import { Column, Row, Spacer, Text, useMaterialColors } from '@expo/ui/jetpack-compose';
import { padding, weight } from '@expo/ui/jetpack-compose/modifiers';

/** MD3 stand-in for a SwiftUI Form `Section`: a text subheader above the rows and quiet footer
 * text below — the full-width list idiom, not iOS's inset-grouped chrome. `trailing` renders at
 * the header's end; SwiftUI needed a hand-drawn header for that, a Row does it natively. */
export function FormSection({
  title,
  trailing,
  footer,
  children,
}: {
  title?: string;
  /** Header-trailing action, e.g. a `TextButton` refresh. */
  trailing?: React.ReactNode;
  footer?: string;
  children: React.ReactNode;
}): React.ReactNode {
  const colors = useMaterialColors();

  return (
    <Column>
      {title === undefined && trailing === undefined ? null : (
        <Row verticalAlignment="center" modifiers={[padding(16, 18, 16, 4)]}>
          <Text style={{ typography: 'titleSmall' }} color={colors.primary}>
            {title ?? ''}
          </Text>
          <Spacer modifiers={[weight(1)]} />
          {trailing}
        </Row>
      )}
      {children}
      {footer === undefined ? null : (
        <Text
          style={{ typography: 'bodySmall' }}
          color={colors.onSurfaceVariant}
          modifiers={[padding(16, 4, 16, 8)]}
        >
          {footer}
        </Text>
      )}
    </Column>
  );
}
