import { useConversation } from '@linkcode/client-core';
import { SessionIdSchema } from '@linkcode/schema';
import { EmptyState } from '@linkcode/ui/native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { ConversationTimeline } from '../../../../components/conversation-timeline';
import { SessionStatusChip } from '../../../../components/session-status-chip';

/** Read-only conversation view of one session running on the host. */
export default function SessionScreen(): React.ReactNode {
  const t = useTranslations('mobile.conversation');
  const insets = useSafeAreaInsets();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const parsed = SessionIdSchema.safeParse(sessionId);
  const conversation = useConversation(parsed.success ? parsed.data : null);
  const scrollRef = useRef<ScrollView>(null);

  return (
    <View className="flex-1 bg-background" style={{ paddingBottom: insets.bottom }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '',
          headerRight: () =>
            conversation.status ? <SessionStatusChip status={conversation.status} /> : null,
        }}
      />
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 16, gap: 12 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {conversation.items.length === 0 ? (
          <EmptyState title={t('emptyTitle')} hint={t('emptyHint')} />
        ) : (
          <ConversationTimeline items={conversation.items} />
        )}
      </ScrollView>
    </View>
  );
}
