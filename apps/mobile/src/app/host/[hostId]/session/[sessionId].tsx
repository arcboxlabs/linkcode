import { useConversation, useSessions } from '@linkcode/client-core';
import { SessionIdSchema } from '@linkcode/schema';
import { AGENT_LABELS, EmptyState, repositoryLabel } from '@linkcode/ui/native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { TimelineItem } from '../../../../components/conversation-timeline';
import { SessionStatusChip } from '../../../../components/session-status-chip';

/** Read-only conversation view of one session running on the host. The inverted list pins
 * to the newest item and leaves the user's scroll position alone while output streams. */
export default function SessionScreen(): React.ReactNode {
  const t = useTranslations('mobile.conversation');
  const insets = useSafeAreaInsets();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const parsed = SessionIdSchema.safeParse(sessionId);
  const conversation = useConversation(parsed.success ? parsed.data : null);
  const { sessions } = useSessions();

  const session = sessions.find((entry) => entry.sessionId === sessionId);
  const title = session
    ? (session.title ?? `${AGENT_LABELS[session.kind]} in ${repositoryLabel(session.cwd)}`)
    : '';
  // Inverted list: index 0 renders at the visual bottom, so newest items pin there.
  const reversed = [...conversation.items].reverse();

  return (
    <View className="flex-1 bg-background" style={{ paddingBottom: insets.bottom }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerRight: () =>
            conversation.status ? <SessionStatusChip status={conversation.status} /> : null,
        }}
      />
      {conversation.items.length === 0 ? (
        <View className="flex-1 justify-center">
          <EmptyState title={t('emptyTitle')} hint={t('emptyHint')} />
        </View>
      ) : (
        <FlatList
          inverted
          data={reversed}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TimelineItem item={item} />}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}
          className="flex-1"
        />
      )}
    </View>
  );
}
