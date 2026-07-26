import { useSessions } from '@linkcode/client-core';
import { SessionIdSchema } from '@linkcode/schema';
import { AGENT_LABELS, EmptyState, repositoryLabel } from '@linkcode/ui/native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { FlatList, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { Composer } from '../../../../components/composer';
import { TimelineItem } from '../../../../components/conversation-timeline';
import { SessionStatusChip } from '../../../../components/session-status-chip';
import { useSeededConversation } from '../../../../runtime/use-seeded-conversation';
import { useSessionActions } from '../../../../runtime/use-session-actions';

/** Conversation view of one session running on the host, with the composer that drives it. The
 * inverted list pins to the newest item and leaves the user's scroll position alone while output
 * streams. */
export default function SessionScreen(): React.ReactNode {
  const t = useTranslations('mobile.conversation');
  const insets = useSafeAreaInsets();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const parsed = SessionIdSchema.safeParse(sessionId);
  const { sessions } = useSessions();

  const session = sessions.find((entry) => entry.sessionId === sessionId);
  const conversation = useSeededConversation(parsed.success ? (session ?? null) : null);
  const { send, stop, isRunning, canCompose, failure } = useSessionActions(
    parsed.success ? parsed.data : null,
    conversation.status,
  );
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
      {/* Sticky rather than an avoiding view: the inverted list already pins to the bottom, so
          the composer only has to ride the keyboard instead of resizing the whole screen. */}
      <KeyboardStickyView>
        <Composer
          onSend={send}
          onStop={stop}
          isRunning={isRunning}
          disabled={!canCompose}
          error={failure ? t(failure === 'send' ? 'sendError' : 'stopError') : undefined}
        />
      </KeyboardStickyView>
    </View>
  );
}
