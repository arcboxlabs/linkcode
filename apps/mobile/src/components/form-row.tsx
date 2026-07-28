import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  badge,
  contentShape,
  font,
  foregroundStyle,
  onTapGesture,
  shapes,
} from '@expo/ui/swift-ui/modifiers';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const TERTIARY = foregroundStyle({ type: 'hierarchical', style: 'tertiary' });
// The stack only covers its text without this, so taps in the empty part of the row are lost.
const WHOLE_ROW = contentShape(shapes.rectangle());

/** A form row that pushes a route. SwiftUI draws the disclosure chevron from `NavigationLink`,
 *  which `@expo/ui` does not expose, so the row draws its own. A tap gesture rather than a
 *  `Button`, which is also what `NavigationLink` is: a Button swallows horizontal drags, and a
 *  row inside `SwipeActions` then opens the route instead of revealing its actions. */
export function NavigationRow({
  title,
  subtitle,
  badgeText,
  onPress,
}: {
  title: string;
  subtitle?: string;
  /** Trailing status text, drawn the way a `List` row badge is — before the chevron. */
  badgeText?: string;
  onPress: () => void;
}): React.ReactNode {
  return (
    <HStack spacing={8} modifiers={[WHOLE_ROW, onTapGesture(onPress), badge(badgeText)]}>
      <VStack alignment="leading" spacing={2}>
        <Text>{title}</Text>
        {subtitle ? (
          <Text modifiers={[font({ textStyle: 'footnote' }), SECONDARY]}>{subtitle}</Text>
        ) : null}
      </VStack>
      <Spacer />
      <Image systemName="chevron.right" size={13} modifiers={[TERTIARY]} />
    </HStack>
  );
}
