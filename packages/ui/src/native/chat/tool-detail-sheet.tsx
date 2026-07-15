import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import {
  toolCallCommand,
  toolCallFailureMessage,
  toolCallFallbackContent,
  toolCallMetadata,
} from '@linkcode/common/chat';
import type { ToolCall } from '@linkcode/schema';
import { useEffect, useRef } from 'react';
import { Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { DiffBlock } from './diff-block';
import { MONO_FONT } from './mono';
import { TerminalBlock } from './terminal-block';
import { TOOL_KIND_ICONS } from './tool-icons';

export interface ToolDetailSheetProps {
  /** The call whose body to show; null keeps the sheet dismissed. */
  toolCall: ToolCall | null;
  onDismiss: () => void;
}

function renderBackdrop(props: BottomSheetBackdropProps): React.ReactNode {
  return <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} />;
}

/**
 * Tool-call body host (design §4.3): tapping a tool row opens this sheet instead of
 * expanding inline, keeping the inverted list's layout stable. Snap points 60% / 95%
 * (Paseo's tool-call sheet). Content mirrors desktop's expanded `ToolCallBody`.
 */
export function ToolDetailSheet({ toolCall, onDismiss }: ToolDetailSheetProps): React.ReactNode {
  const sheetRef = useRef<BottomSheetModal>(null);
  const [mutedColor, dangerColor, backgroundColor] = useCSSVariable([
    '--muted',
    '--danger',
    '--background',
  ]);

  useEffect(() => {
    if (toolCall) sheetRef.current?.present();
    else sheetRef.current?.dismiss();
  }, [toolCall]);

  const metadata = toolCall ? toolCallMetadata(toolCall) : [];
  const failure = toolCall ? toolCallFailureMessage(toolCall) : undefined;
  const fallbackBlocks = toolCall ? toolCallFallbackContent(toolCall) : [];
  const command = toolCall?.kind === 'execute' ? toolCallCommand(toolCall) : undefined;
  const rawOutput =
    toolCall && typeof toolCall.rawOutput === 'string' ? toolCall.rawOutput : undefined;
  const Icon = toolCall ? TOOL_KIND_ICONS[toolCall.kind] : null;

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={['60%', '95%']}
      enableDynamicSizing={false}
      onDismiss={onDismiss}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: String(backgroundColor) }}
      handleIndicatorStyle={{ backgroundColor: String(mutedColor) }}
    >
      <BottomSheetScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        {toolCall && Icon ? (
          <View className="flex-row items-center gap-2">
            <Icon
              size={16}
              color={String(toolCall.status === 'failed' ? dangerColor : mutedColor)}
            />
            <Text
              className={`flex-1 text-[14px] ${toolCall.status === 'failed' ? 'text-danger' : 'text-foreground'}`}
              style={{ fontWeight: '600' }}
              numberOfLines={1}
            >
              {toolCall.title}
            </Text>
          </View>
        ) : null}
        {metadata.length > 0 ? (
          <View className="flex-row flex-wrap gap-1.5">
            {metadata.map((entry) => (
              <View key={entry.key} className="rounded-md bg-surface-secondary px-2 py-1">
                <Text
                  className={`text-[10.5px] ${entry.tone === 'error' ? 'text-danger' : 'text-muted'}`}
                  style={{ fontFamily: MONO_FONT }}
                >
                  {entry.key} {entry.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {toolCall?.content.map((content, index) => {
          if (content.type === 'diff') {
            return (
              <DiffBlock
                // eslint-disable-next-line @eslint-react/no-array-index-key -- tool content carries no id; snapshots replace wholesale
                key={index}
                path={content.path}
                oldText={content.oldText}
                newText={content.newText}
              />
            );
          }
          if (content.type === 'content' && content.content.type === 'text') {
            return (
              <Text
                // eslint-disable-next-line @eslint-react/no-array-index-key -- tool content carries no id; snapshots replace wholesale
                key={index}
                className="text-[13px] text-foreground"
                style={{ lineHeight: 19 }}
              >
                {content.content.text}
              </Text>
            );
          }
          return null;
        })}
        {fallbackBlocks.map((block, index) =>
          block.type === 'text' ? (
            <Text
              // eslint-disable-next-line @eslint-react/no-array-index-key -- fallback blocks carry no id
              key={index}
              className="text-[13px] text-foreground"
              style={{ lineHeight: 19 }}
            >
              {block.text}
            </Text>
          ) : null,
        )}
        {rawOutput !== undefined || command ? (
          <TerminalBlock command={command} output={rawOutput ?? ''} />
        ) : null}
        {failure ? (
          <Text className="text-[13px] text-danger" style={{ lineHeight: 19 }}>
            {failure}
          </Text>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}
