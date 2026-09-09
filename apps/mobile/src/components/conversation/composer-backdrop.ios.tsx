import { Host, Spacer, VStack } from '@expo/ui/swift-ui';
import { frame, glassEffect } from '@expo/ui/swift-ui/modifiers';
import { USES_IOS_26_NAVIGATION } from '@mobile/components/shell/ios-26-navigation';
import { View } from 'react-native';

const GLASS = [
  frame({ maxWidth: Number.POSITIVE_INFINITY, maxHeight: Number.POSITIVE_INFINITY }),
  glassEffect({
    glass: { variant: 'regular' },
    shape: 'roundedRectangle',
    cornerRadius: 24,
  }),
];

export function ComposerBackdrop(): React.ReactNode {
  if (!USES_IOS_26_NAVIGATION) return null;
  return (
    <View className="absolute inset-0" pointerEvents="none">
      <Host style={{ flex: 1 }}>
        <VStack modifiers={GLASS}>
          <Spacer />
        </VStack>
      </Host>
    </View>
  );
}
