import { useSessions } from '@linkcode/client-core';
import type { SessionId, ToolCall } from '@linkcode/schema';
import { SessionIdSchema } from '@linkcode/schema';
import {
  AGENT_LABELS,
  EmptyState,
  repositoryLabel,
  selectCurrentPlan,
  selectPendingPromptItems,
} from '@linkcode/ui/native';
import { Composer } from '@mobile/components/conversation/composer';
import { PromptDock } from '@mobile/components/conversation/prompt-dock/prompt-dock';
import { SessionStatusChip } from '@mobile/components/conversation/session-status-chip';
import { TimelineItem } from '@mobile/components/conversation/timeline-item';
import { ToolDetailSheet } from '@mobile/components/conversation/tool-detail-sheet/tool-detail-sheet';
import { useSeededConversation } from '@mobile/runtime/use-seeded-conversation';
import { useSessionActions } from '@mobile/runtime/use-session-actions';
import { useSessionAutoResume } from '@mobile/runtime/use-session-auto-resume';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { noop } from 'foxact/noop';
import { useThemeColor } from 'heroui-native';
import { EllipsisIcon } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

/** Conversation view of one session running on the host, with the composer that drives it and
 * the prompt dock that answers its asks. The inverted list pins to the newest item and leaves
 * the user's scroll position alone while output streams. */
export default function SessionScreen(): React.ReactNode {
  const t = useTranslations('mobile.conversation');
  const tChat = useTranslations('mobile.chat');
  const insets = useSafeAreaInsets();
  const muted = useThemeColor('muted');
  const router = useRouter();
  const { sessionId: rawSessionId, autoResume } = useLocalSearchParams<{
    sessionId: string;
    autoResume?: string;
  }>();
  const autoResumeSuppressed = autoResume === 'false';
  const parsed = SessionIdSchema.safeParse(rawSessionId);
  const sessionId: SessionId | null = parsed.success ? parsed.data : null;
  const { sessions, refresh } = useSessions();

  const session = sessions.find((entry) => entry.sessionId === sessionId);
  // A deep link or a notification can open a thread the snapshot has never listed. Without its
  // record there is no `kind`/`historyId`, so the seed reads nothing and the past renders as empty
  // rather than as loading. Deduped per id so a genuinely gone session doesn't spin.
  const refreshedForRef = useRef<SessionId | null>(null);
  useEffect(() => {
    if (session || !sessionId || refreshedForRef.current === sessionId) return;
    refreshedForRef.current = sessionId;
    void refresh().catch(noop);
  }, [session, sessionId, refresh]);
  const conversation = useSeededConversation(sessionId, session ?? null);
  const actions = useSessionActions(sessionId, conversation.status);
  const { stop } = useSessionAutoResume(sessionId, session?.status, autoResumeSuppressed);
  const [openToolCallId, setOpenToolCallId] = useState<string | null>(null);

  const title = session
    ? (session.title ?? `${AGENT_LABELS[session.kind]} in ${repositoryLabel(session.cwd)}`)
    : '';

  const prompts = selectPendingPromptItems(conversation);
  const plan = selectCurrentPlan(conversation);
  const openToolCall: ToolCall | null =
    conversation.items.findLast(
      (item): item is typeof item & { kind: 'tool' } =>
        item.kind === 'tool' && item.toolCall.toolCallId === openToolCallId,
    )?.toolCall ?? null;

  const showMenu = (): void => {
    if (!sessionId) return;
    Alert.alert(title, undefined, [
      {
        text: tChat('stopThread'),
        style: 'destructive',
        onPress() {
          router.setParams({ autoResume: 'false' });
          stop();
        },
      },
      {
        text: tChat('copyThreadId'),
        onPress() {
          void Clipboard.setStringAsync(sessionId);
        },
      },
      { text: tChat('cancel'), style: 'cancel' },
    ]);
  };

  // Inverted list: index 0 renders at the visual bottom, so newest items pin there.
  const reversed = [...conversation.items].reverse();

  return (
    <View className="flex-1 bg-background" style={{ paddingBottom: insets.bottom }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerRight: () => (
            <View className="flex-row items-center gap-1">
              {conversation.status ? <SessionStatusChip status={conversation.status} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tChat('stopThread')}
                onPress={showMenu}
                className="size-8 items-center justify-center"
              >
                <EllipsisIcon size={18} color={muted} />
              </Pressable>
            </View>
          ),
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
          renderItem={({ item }) => (
            <TimelineItem
              item={item}
              onPressTool={(toolCall) => setOpenToolCallId(toolCall.toolCallId)}
            />
          )}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}
          className="flex-1"
        />
      )}
      {/* Sticky rather than an avoiding view: the inverted list already pins to the bottom, so
          the composer only has to ride the keyboard instead of resizing the whole screen. */}
      <KeyboardStickyView>
        <PromptDock
          prompts={prompts}
          plan={plan}
          respondingIds={actions.respondingIds}
          onRespondPermission={actions.respondPermission}
          onRespondQuestion={actions.respondQuestion}
        />
        <Composer
          onSend={actions.send}
          onStop={actions.stop}
          isRunning={actions.isRunning}
          disabled={!actions.canCompose}
          error={
            actions.failure ? t(actions.failure === 'send' ? 'sendError' : 'stopError') : undefined
          }
        />
      </KeyboardStickyView>
      <ToolDetailSheet toolCall={openToolCall} onDismiss={() => setOpenToolCallId(null)} />
    </View>
  );
}
