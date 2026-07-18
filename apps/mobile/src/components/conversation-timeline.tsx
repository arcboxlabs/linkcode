import type { ConversationItem } from '@linkcode/client-core';
import type { ContentBlock } from '@linkcode/schema';
import { Card, Chip } from 'heroui-native';
import { Text, View } from 'react-native';
import { useTranslations } from 'use-intl';

function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join('')
    .trim();
}

const PLAN_STATUS_MARK = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
} as const;

/** Compact token counts ("193437" → "193.4k") — mirrors the web CompactionMarker's format. */
function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

/** Read-only rendering of the conversation view-model; one card per timeline item. */
export function ConversationTimeline({ items }: { items: ConversationItem[] }): React.ReactNode {
  const t = useTranslations('mobile.conversation');

  return (
    <View className="gap-3">
      {items.map((item) => {
        switch (item.kind) {
          case 'message': {
            const isUser = item.role === 'user';
            return (
              <Card key={item.id} className={isUser ? 'ml-8' : 'mr-8'}>
                <Card.Body className="gap-1">
                  <Text className="font-semibold text-caption text-muted">
                    {isUser ? t('you') : t('agent')}
                  </Text>
                  <Text className="text-body text-foreground">{blocksToText(item.blocks)}</Text>
                  {item.isStreaming ? (
                    <Text className="text-footnote text-muted">{t('streaming')}</Text>
                  ) : null}
                </Card.Body>
              </Card>
            );
          }
          case 'reasoning':
            return (
              <View key={item.id} className="px-2">
                <Text className="font-semibold text-caption text-muted">{t('reasoning')}</Text>
                <Text className="text-muted text-subhead">{blocksToText(item.blocks)}</Text>
              </View>
            );
          case 'tool':
            return (
              <Card key={item.id} className="mr-8">
                <Card.Body className="flex-row items-center gap-2">
                  <Chip variant="soft" size="sm" color="default">
                    <Chip.Label>{t('tool')}</Chip.Label>
                  </Chip>
                  <Text className="flex-1 text-foreground text-subhead" numberOfLines={2}>
                    {item.toolCall.title}
                  </Text>
                  <Text className="text-footnote text-muted">{item.toolCall.status}</Text>
                </Card.Body>
              </Card>
            );
          case 'plan':
            return (
              <Card key={item.id} className="mr-8">
                <Card.Header>
                  <Card.Title>{t('plan')}</Card.Title>
                </Card.Header>
                <Card.Body className="gap-1">
                  {item.plan.entries.map((entry, index) => (
                    <Text
                      // eslint-disable-next-line @eslint-react/no-array-index-key -- plan entries carry no id; index is stable because plans are replaced wholesale
                      key={index}
                      className="text-foreground text-subhead"
                    >
                      {PLAN_STATUS_MARK[entry.status]} {entry.content}
                    </Text>
                  ))}
                </Card.Body>
              </Card>
            );
          case 'approval':
            return (
              <Card key={item.id} className="mr-8">
                <Card.Body className="gap-1">
                  <Text className="font-semibold text-caption text-warning">{t('approval')}</Text>
                  <Text className="text-foreground text-subhead">{item.toolCall.title ?? ''}</Text>
                </Card.Body>
              </Card>
            );
          case 'error':
            return (
              <Card key={item.id}>
                <Card.Body className="gap-1">
                  <Text className="font-semibold text-caption text-danger">{t('error')}</Text>
                  <Text className="text-foreground text-subhead">{item.message}</Text>
                </Card.Body>
              </Card>
            );
          case 'compaction':
            if (item.status === 'in_progress') {
              return (
                <View key={item.id} className="flex-row items-center justify-center gap-2 px-2">
                  <Text className="text-[12px] text-muted" style={{ fontWeight: '600' }}>
                    {t('compacting')}
                  </Text>
                </View>
              );
            }
            return (
              <View key={item.id} className="flex-row items-center justify-center gap-2 px-2">
                <Text className="font-semibold text-footnote text-muted">{t('compacted')}</Text>
                {item.preTokens !== undefined && item.postTokens !== undefined ? (
                  <Text className="text-footnote text-muted">
                    {t('compactedTokens', {
                      pre: formatTokens(item.preTokens),
                      post: formatTokens(item.postTokens),
                    })}
                  </Text>
                ) : null}
              </View>
            );
          default:
            return null;
        }
      })}
    </View>
  );
}
