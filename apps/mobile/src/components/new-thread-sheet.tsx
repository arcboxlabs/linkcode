import {
  BottomSheet,
  Button,
  Form,
  Host,
  HStack,
  Picker,
  Section,
  Text,
  TextField,
  useNativeState,
  VStack,
} from '@expo/ui/swift-ui';
import {
  autocorrectionDisabled,
  disabled,
  font,
  foregroundStyle,
  pickerStyle,
  tag,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers';
import type { AgentKind, WorkspaceRecord } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { AGENT_LABELS, repositoryLabel } from '@linkcode/ui/native';
import { useState } from 'react';
import { useTranslations } from 'use-intl';

const SECONDARY = foregroundStyle({ type: 'hierarchical', style: 'secondary' });
const FOOTNOTE = font({ textStyle: 'footnote' });

/** New-thread sheet: agent picker + workspace (project) picker with a custom-path fallback.
 * The parent owns creation and presentation; it closes the sheet by flipping `isPresented`. */
export function NewThreadSheet({
  isPresented,
  onIsPresentedChange,
  workspaces,
  creating,
  onCreate,
}: {
  isPresented: boolean;
  onIsPresentedChange: (isPresented: boolean) => void;
  workspaces: WorkspaceRecord[];
  creating: boolean;
  onCreate: (kind: AgentKind, cwd: string) => void;
}): React.ReactNode {
  const t = useTranslations('mobile.sessions');

  const [kind, setKind] = useState<AgentKind>(AgentKindSchema.options[0]);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const customPath = useNativeState('');

  // Recency order mirrors the thread groups; the most recent project is the default pick.
  const ordered = [...workspaces].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  const effectiveCwd = selectedCwd ?? ordered[0]?.cwd ?? null;

  const create = () => {
    const target = effectiveCwd ?? customPath.get().trim();
    if (target) onCreate(kind, target);
  };

  return (
    // `BottomSheet` is SwiftUI like any other `@expo/ui` view and red-boxes when mounted straight
    // into the RN tree. The host carries no layout of its own — the sheet presents over the whole
    // screen from UIKit — so it stays zero-sized and lets touches through to the screen behind it.
    <Host style={{ position: 'absolute' }} pointerEvents="box-none">
      {/* Sized to its content, or SwiftUI presents it at a near-full-screen detent — a sheet this
          short reads as a takeover otherwise. */}
      <BottomSheet
        isPresented={isPresented}
        onIsPresentedChange={onIsPresentedChange}
        fitToContents
      >
        <Form>
          {/* Segmented rather than the old icon chips: the agent brand marks are RN SVG
            components, which have no place in a SwiftUI view tree. */}
          <Section title={t('kindLabel')}>
            <Picker
              selection={kind}
              onSelectionChange={setKind}
              modifiers={[pickerStyle('segmented')]}
            >
              {AgentKindSchema.options.map((option) => (
                <Text key={option} modifiers={[tag(option)]}>
                  {AGENT_LABELS[option]}
                </Text>
              ))}
            </Picker>
          </Section>

          {ordered.length > 0 ? (
            // An inline picker draws the selection checkmark itself, replacing the hand-placed one.
            <Section title={t('projectLabel')}>
              <Picker
                selection={effectiveCwd}
                onSelectionChange={setSelectedCwd}
                modifiers={[pickerStyle('inline')]}
              >
                {ordered.map((workspace) => (
                  <VStack
                    key={workspace.workspaceId}
                    alignment="leading"
                    spacing={2}
                    modifiers={[tag(workspace.cwd)]}
                  >
                    <Text>{workspace.name ?? repositoryLabel(workspace.cwd)}</Text>
                    <Text modifiers={[FOOTNOTE, SECONDARY]}>{workspace.cwd}</Text>
                  </VStack>
                ))}
              </Picker>
            </Section>
          ) : (
            <Section>
              <HStack spacing={12}>
                <Text>{t('cwdLabel')}</Text>
                <TextField
                  testID="thread-cwd-input"
                  text={customPath}
                  placeholder={t('cwdPlaceholder')}
                  modifiers={[textInputAutocapitalization('never'), autocorrectionDisabled()]}
                />
              </HStack>
            </Section>
          )}

          <Section>
            <Button label={t('create')} onPress={create} modifiers={[disabled(creating)]} />
          </Section>
        </Form>
      </BottomSheet>
    </Host>
  );
}
