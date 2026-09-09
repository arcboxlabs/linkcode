import { repositoryLabel } from '@linkcode/ui/native';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { SheetPicker } from '@mobile/components/form/sheet-picker.android';
import type { ProjectRowProps } from '@mobile/components/host/new-thread/project-row.types';
import { ChevronsUpDownIcon, FolderIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTranslations } from 'use-intl';

/** Android workspace picker above the composer: a bare row opening the workspace list as a
 * bottom sheet. Falls back to a free path field while the host has no workspaces. */
export function ProjectRow({
  workspaces,
  workspaceLabel,
  cwd,
  onCwdChange,
  customPath,
  onCustomPathChange,
}: ProjectRowProps): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const colors = useAppMaterialColors();
  const [open, setOpen] = useState(false);

  if (workspaces.length === 0) {
    return (
      <View className="flex-row items-center gap-2 px-6 pb-1.5">
        <FolderIcon size={15} color={colors.onSurfaceVariant} strokeWidth={2} />
        <TextInput
          testID="thread-cwd-input"
          className="flex-1 py-1 text-callout"
          style={{ color: colors.onSurface }}
          placeholder={t('cwdPlaceholder')}
          placeholderTextColor={colors.onSurfaceVariant}
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('projectLabel')}: ${workspaceLabel}`}
        onPress={() => setOpen(true)}
        className="flex-row items-center gap-2 py-1"
      >
        <FolderIcon size={15} color={colors.onSurfaceVariant} strokeWidth={2} />
        <Text className="text-callout" style={{ color: colors.onSurface }}>
          {workspaceLabel}
        </Text>
        <ChevronsUpDownIcon size={11} color={colors.onSurfaceVariant} />
      </Pressable>
      <SheetPicker
        open={open}
        onClose={() => setOpen(false)}
        sections={[
          {
            id: 'workspace',
            title: t('projectLabel'),
            selection: cwd,
            options: workspaces.map((workspace) => ({
              id: workspace.cwd,
              label: workspace.name ?? repositoryLabel(workspace.cwd),
              hint: workspace.cwd,
            })),
            onSelect: onCwdChange,
          },
        ]}
      />
    </View>
  );
}
