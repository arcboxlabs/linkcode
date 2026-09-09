import { FloatingActionButton, Icon } from '@expo/ui/jetpack-compose';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import type { PrimaryAction } from '@mobile/components/shell/primary-action';
import { View } from 'react-native';
import addGlyph from '../../../assets/icons/add.xml';

/** The tab's primary action as an MD3 floating action button at the screen's bottom-right — the
 * Android counterpart of the iOS header bar item / iOS-26 tab-bar slot. */
export function PrimaryActionFab({ action }: { action: PrimaryAction | null }): React.ReactNode {
  if (!action) return null;

  return (
    <View className="absolute right-4 bottom-4" pointerEvents="box-none">
      <ThemedHost matchContents>
        <FloatingActionButton onClick={action.onPress}>
          <FloatingActionButton.Icon>
            <Icon source={addGlyph} contentDescription={action.label} />
          </FloatingActionButton.Icon>
        </FloatingActionButton>
      </ThemedHost>
    </View>
  );
}
