import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font } from '@expo/ui/swift-ui/modifiers';
import { FOOTNOTE, SECONDARY } from '@mobile/components/form/styles';
import type { CloudUser } from '@mobile/runtime/cloud/account';

/** SF Symbol rather than the account's picture: `@expo/ui`'s `Image` takes SF Symbols, asset
 *  catalog names, and local files — never a remote URL. Apple sign-in supplies no picture
 *  anyway, so this is the fallback the old avatar already showed in the common case. */
export function ProfileRow({ user }: { user: CloudUser }): React.ReactNode {
  return (
    <HStack spacing={12}>
      <Image systemName="person.crop.circle.fill" size={40} modifiers={[SECONDARY]} />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ textStyle: 'headline' })]}>{user.name || user.email}</Text>
        <Text modifiers={[FOOTNOTE, SECONDARY]}>{user.email}</Text>
      </VStack>
      <Spacer />
    </HStack>
  );
}
