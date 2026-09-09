import { Host, HStack, Image, Menu, Picker, Text as UIText } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  font,
  foregroundStyle,
  padding,
  tag,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import type { WorkspaceRecord } from '@linkcode/schema';
import { repositoryLabel } from '@linkcode/ui/native';
import { Color } from 'expo-router';
import { useThemeColor } from 'heroui-native';
import { FolderIcon } from 'lucide-react-native';
import { TextInput, View } from 'react-native';
import { useTranslations } from 'use-intl';

const ICON = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const VALUE = foregroundStyle({ type: 'hierarchical', style: 'primary' });
const BODY = font({ textStyle: 'body' });
/** SwiftUI draws a Menu label with the accent tint, and hierarchical styles derive from it —
 * re-tinting to the label color turns the value primary and the icons secondary. */
const LABEL_TINT = tint(Color.ios.label);

/** The workspace picker as its own frame segment above the composer — outside the card, like the
 * web composer's context bar: a bare row (icon + value + the up/down affordance) opening a native
 * `UIMenu`. Falls back to a free path field while the host has no workspaces. */
export function ProjectRow({
  workspaces,
  workspaceLabel,
  cwd,
  onCwdChange,
  customPath,
  onCustomPathChange,
}: {
  /** Already in recency order; the head is the default pick. */
  workspaces: WorkspaceRecord[];
  workspaceLabel: string;
  cwd: string | null;
  onCwdChange: (cwd: string) => void;
  customPath: string;
  onCustomPathChange: (path: string) => void;
}): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const muted = useThemeColor('muted');

  if (workspaces.length === 0) {
    return (
      <View className="flex-row items-center gap-2 px-6 pb-1.5">
        <FolderIcon size={15} color={muted} strokeWidth={2} />
        <TextInput
          testID="thread-cwd-input"
          className="flex-1 py-1 text-callout text-foreground"
          placeholder={t('cwdPlaceholder')}
          placeholderTextColor={muted}
          value={customPath}
          onChangeText={onCustomPathChange}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
    );
  }

  return (
    <View className="flex-row px-5 pb-1">
      <Host matchContents>
        <Menu
          modifiers={[LABEL_TINT]}
          label={
            <HStack
              spacing={8}
              modifiers={[
                accessibilityLabel(`${t('projectLabel')}: ${workspaceLabel}`),
                padding({ vertical: 4 }),
              ]}
            >
              <Image systemName="folder" size={15} modifiers={[ICON]} />
              <UIText modifiers={[BODY, VALUE]}>{workspaceLabel}</UIText>
              <Image systemName="chevron.up.chevron.down" size={11} modifiers={[ICON]} />
            </HStack>
          }
        >
          <Picker selection={cwd ?? undefined} onSelectionChange={onCwdChange}>
            {workspaces.map((workspace) => (
              <UIText key={workspace.workspaceId} modifiers={[tag(workspace.cwd)]}>
                {workspace.name ?? repositoryLabel(workspace.cwd)}
              </UIText>
            ))}
          </Picker>
        </Menu>
      </Host>
    </View>
  );
}
