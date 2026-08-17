import { Column, ModalBottomSheet, Text } from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  horizontalScroll,
  padding,
  verticalScroll,
} from '@expo/ui/jetpack-compose/modifiers';
import type { ToolCall } from '@linkcode/schema';
import { useAppMaterialColors } from '@mobile/components/form/compose-theme.android';
import { ThemedHost } from '@mobile/components/form/themed-host.android';
import { useTranslations } from 'use-intl';
import { DiffBlock } from './diff-block';
import { toolDetailContent } from './tool-detail-content';

const MONO = { typography: 'bodySmall', fontFamily: 'monospace' } as const;

/**
 * Android tool-call body sheet (design §4.3): tapping a tool row opens this instead of expanding
 * inline, keeping the inverted list's layout stable. The SF kind glyph has no Compose asset, so
 * the title carries the row alone.
 */
export function ToolDetailSheet({
  toolCall,
  onDismiss,
}: {
  /** The call whose body to show; null keeps the sheet dismissed. */
  toolCall: ToolCall | null;
  onDismiss: () => void;
}): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const colors = useAppMaterialColors();
  const { metadata, contents, failure, command, rawOutput } = toolDetailContent(toolCall);

  if (toolCall === null) return null;

  return (
    <ThemedHost style={{ position: 'absolute' }} pointerEvents="box-none">
      <ModalBottomSheet onDismissRequest={onDismiss}>
        <Column
          verticalArrangement={{ spacedBy: 12 }}
          modifiers={[verticalScroll(), fillMaxWidth(), padding(16, 0, 16, 24)]}
        >
          <Text
            style={{ typography: 'titleSmall' }}
            color={toolCall.status === 'failed' ? colors.error : undefined}
            maxLines={1}
            overflow="ellipsis"
          >
            {toolCall.title}
          </Text>
          {metadata.length > 0 ? (
            <Column verticalArrangement={{ spacedBy: 2 }}>
              {metadata.map((entry) => (
                <Text
                  key={`${entry.key}:${entry.label ?? ''}:${entry.value}`}
                  style={MONO}
                  color={colors.onSurfaceVariant}
                  maxLines={2}
                >
                  {[entry.label ?? entry.key, entry.value].join(' ')}
                </Text>
              ))}
            </Column>
          ) : null}
          {contents.map((content, index) => {
            if (content.type === 'diff') {
              return (
                <DiffBlock
                  // eslint-disable-next-line @eslint-react/no-array-index-key -- tool content carries no id; snapshots replace wholesale
                  key={index}
                  path={content.path}
                  oldText={content.oldText}
                  newText={content.newText}
                  patch={content.patch?.text}
                />
              );
            }
            if (content.type === 'content' && content.content.type === 'text') {
              return (
                <Text
                  // eslint-disable-next-line @eslint-react/no-array-index-key -- tool content carries no id; snapshots replace wholesale
                  key={index}
                  style={{ typography: 'bodySmall' }}
                >
                  {content.content.text}
                </Text>
              );
            }
            return null;
          })}
          {command || rawOutput ? (
            <Column verticalArrangement={{ spacedBy: 4 }} modifiers={[fillMaxWidth()]}>
              {command ? (
                <Text style={MONO} color={colors.onSurfaceVariant} maxLines={2}>
                  {command}
                </Text>
              ) : null}
              {rawOutput ? (
                <Column modifiers={[horizontalScroll(), fillMaxWidth()]}>
                  <Text style={MONO} softWrap={false}>
                    {rawOutput}
                  </Text>
                </Column>
              ) : null}
            </Column>
          ) : null}
          {failure ? (
            <Text style={{ typography: 'bodySmall' }} color={colors.error}>
              {t('failed')}: {failure}
            </Text>
          ) : null}
        </Column>
      </ModalBottomSheet>
    </ThemedHost>
  );
}
