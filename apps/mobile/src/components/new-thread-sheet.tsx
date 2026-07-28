import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import type { AgentKind, WorkspaceRecord } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { AGENT_LABELS, AgentIcon, repositoryLabel, SectionLabel } from '@linkcode/ui/native';
import { Button, Chip, Input, Label, ListGroup, TextField, useThemeColor } from 'heroui-native';
import { CheckIcon } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

function SheetBackdrop(props: BottomSheetBackdropProps): React.ReactNode {
  return <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />;
}

/** New-thread sheet: agent picker + workspace (project) picker with a custom-path fallback.
 * The parent owns creation; it dismisses the sheet via the modal ref on success. */
export function NewThreadSheet({
  ref,
  workspaces,
  creating,
  onCreate,
}: {
  ref?: React.Ref<BottomSheetModal>;
  workspaces: WorkspaceRecord[];
  creating: boolean;
  onCreate: (kind: AgentKind, cwd: string) => void;
}): React.ReactNode {
  const t = useTranslations('mobile.sessions');
  const insets = useSafeAreaInsets();
  const [background, accent, accentForeground] = useThemeColor([
    'background',
    'accent',
    'accent-foreground',
  ]);

  const [kind, setKind] = useState<AgentKind>(AgentKindSchema.options[0]);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [customPath, setCustomPath] = useState('');

  // Recency order mirrors the thread groups; the most recent project is the default pick.
  const ordered = [...workspaces].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  const effectiveCwd = selectedCwd ?? ordered[0]?.cwd ?? null;
  const targetCwd = effectiveCwd ?? customPath.trim();

  return (
    <BottomSheetModal
      ref={ref}
      backdropComponent={SheetBackdrop}
      backgroundStyle={{ backgroundColor: background }}
      handleIndicatorStyle={{ backgroundColor: accent }}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
    >
      <BottomSheetScrollView>
        <View className="gap-5 px-5 pt-2" style={{ paddingBottom: insets.bottom + 16 }}>
          <View className="gap-2">
            <SectionLabel>{t('kindLabel')}</SectionLabel>
            <View className="flex-row flex-wrap gap-2">
              {AgentKindSchema.options.map((option) => (
                <Chip
                  key={option}
                  variant={kind === option ? 'primary' : 'soft'}
                  color={kind === option ? 'accent' : 'default'}
                  onPress={() => setKind(option)}
                >
                  <View className="flex-row items-center gap-1.5">
                    <AgentIcon
                      kind={option}
                      variant="ghost"
                      size={14}
                      color={kind === option ? accentForeground : undefined}
                    />
                    <Chip.Label>{AGENT_LABELS[option]}</Chip.Label>
                  </View>
                </Chip>
              ))}
            </View>
          </View>

          {ordered.length > 0 ? (
            <View className="gap-2">
              <SectionLabel>{t('projectLabel')}</SectionLabel>
              <ListGroup>
                {ordered.map((workspace) => (
                  <ListGroup.Item
                    key={workspace.workspaceId}
                    onPress={() => setSelectedCwd(workspace.cwd)}
                  >
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>
                        {workspace.name ?? repositoryLabel(workspace.cwd)}
                      </ListGroup.ItemTitle>
                      <ListGroup.ItemDescription numberOfLines={1}>
                        {workspace.cwd}
                      </ListGroup.ItemDescription>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      {workspace.cwd === effectiveCwd ? (
                        <CheckIcon size={16} color={accent} />
                      ) : null}
                    </ListGroup.ItemSuffix>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            </View>
          ) : (
            <TextField>
              <Label>{t('cwdLabel')}</Label>
              <Input
                value={customPath}
                onChangeText={setCustomPath}
                placeholder={t('cwdPlaceholder')}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </TextField>
          )}

          <Button
            isDisabled={creating || !targetCwd}
            onPress={() => {
              if (targetCwd) onCreate(kind, targetCwd);
            }}
          >
            <Button.Label>{t('create')}</Button.Label>
          </Button>
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}
