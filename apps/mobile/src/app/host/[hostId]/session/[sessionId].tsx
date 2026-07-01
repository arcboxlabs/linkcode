import { useConversation } from '@linkcode/client-core';
import { SessionIdSchema } from '@linkcode/schema';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Button } from 'heroui-native';
import { useRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { ConversationTimeline } from '../../../../components/conversation-timeline';
import { SessionStatusChip } from '../../../../components/session-status-chip';

/** Read-only conversation view of one session running on the host. */
export default function SessionScreen(): React.ReactNode {
  const t = useTranslations('mobile.conversation');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const parsed = SessionIdSchema.safeParse(sessionId);
  const conversation = useConversation(parsed.success ? parsed.data : null);
  const scrollRef = useRef<ScrollView>(null);

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="flex-row items-center justify-between px-4 py-2">
        <Button variant="ghost" size="sm" onPress={() => router.back()}>
          <Button.Label>‹</Button.Label>
        </Button>
        {conversation.status ? <SessionStatusChip status={conversation.status} /> : null}
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{ padding: 16, gap: 12 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {conversation.items.length === 0 ? (
          <View className="gap-1 py-12">
            <Text className="text-center text-[15px] text-foreground" style={{ fontWeight: '500' }}>
              {t('emptyTitle')}
            </Text>
            <Text className="text-center text-[13px] text-muted" style={{ lineHeight: 18 }}>
              {t('emptyHint')}
            </Text>
          </View>
        ) : (
          <ConversationTimeline items={conversation.items} />
        )}
      </ScrollView>
    </View>
  );
}
