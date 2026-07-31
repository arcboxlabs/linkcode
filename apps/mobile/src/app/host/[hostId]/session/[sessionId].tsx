import { useLinkCodeClient, useSessions } from '@linkcode/client-core';
import type { SessionId, ToolCall } from '@linkcode/schema';
import { SessionIdSchema } from '@linkcode/schema';
import {
  AGENT_LABELS,
  EmptyState,
  repositoryLabel,
  selectCurrentPlan,
  selectPendingPromptItems,
} from '@linkcode/ui/native';
import * as Clipboard from 'expo-clipboard';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { noop } from 'foxact/noop';
import { useThemeColor } from 'heroui-native';
import { EllipsisIcon } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';
import { Composer } from '../../../../components/composer';
import { TimelineItem } from '../../../../components/conversation-timeline';
import { PromptDock } from '../../../../components/prompt-dock';
import { SessionStatusChip } from '../../../../components/session-status-chip';
import { ToolDetailSheet } from '../../../../components/tool-detail-sheet';
import { useSeededConversation } from '../../../../runtime/use-seeded-conversation';
import { useSessionActions } from '../../../../runtime/use-session-actions';

/** Conversation view of one session running on the host, with the composer that drives it and
 * the prompt dock that answers its asks. The inverted list pins to the newest item and leaves
 * the user's scroll position alone while output streams. */
export default function SessionScreen(): React.ReactNode {
  const t = useTranslations('mobile.conversation');
  const tChat = useTranslations('mobile.chat');
  const insets = useSafeAreaInsets();
  const client = useLinkCodeClient();
  const muted = useThemeColor('muted');
  const router = useRouter();
  const { sessionId: rawSessionId, autoResume } = useLocalSearchParams<{
    sessionId: string;
    autoResume?: string;
  }>();
  const autoResumeSuppressed = autoResume === 'false';
  const parsed = SessionIdSchema.safeParse(rawSessionId);
  const sessionId: SessionId | null = parsed.success ? parsed.data : null;
  const { sessions } = useSessions();

  const session = sessions.find((entry) => entry.sessionId === sessionId);
  const conversation = useSeededConversation(sessionId, session ?? null);
  const actions = useSessionActions(sessionId, conversation.status);
  const [openToolCallId, setOpenToolCallId] = useState<string | null>(null);
  const observedSessionRef = useRef<SessionId | null>(null);
  const resumeInFlightRef = useRef<SessionId | null>(null);
  const resumePromiseRef = useRef<Promise<unknown> | null>(null);
  const resumeFailedRef = useRef<SessionId | null>(null);

  const resume = useCallback(
    (id: SessionId) => {
      if (autoResumeSuppressed || resumeInFlightRef.current === id) return;
      resumeInFlightRef.current = id;
      resumeFailedRef.current = null;
      const promise = client
        .resumeSession(id)
        .catch(() => {
          resumeFailedRef.current = id;
        })
        .finally(() => {
          if (resumeInFlightRef.current === id) resumeInFlightRef.current = null;
          if (resumePromiseRef.current === promise) resumePromiseRef.current = null;
        });
      resumePromiseRef.current = promise;
    },
    [autoResumeSuppressed, client],
  );

  const stop = useCallback(
    (id: SessionId) => {
      void client.stopSession(id).catch(noop);
    },
    [client],
  );

  useEffect(() => {
    if (autoResumeSuppressed) resumeFailedRef.current = null;
  }, [autoResumeSuppressed]);

  // The daemon re-broadcasts open asks to attachers — a reopened app regains pending approvals.
  // A failed cold resume retries when the screen next focuses or the client generation changes.
  useFocusEffect(
    useCallback(() => {
      if (
        sessionId &&
        !autoResumeSuppressed &&
        session?.status === 'stopped' &&
        resumeFailedRef.current === sessionId
      ) {
        resume(sessionId);
      }
    }, [autoResumeSuppressed, resume, sessionId, session?.status]),
  );

  // Desktop parity (`applySelection`): opening a stopped session resumes it silently, once.
  // Mark every opened session as observed, including running ones, so an explicit later Stop does
  // not immediately wake it again. This also re-enables a cold session's disabled composer.
  useEffect(() => {
    if (!sessionId || !session || observedSessionRef.current === sessionId) return;
    observedSessionRef.current = sessionId;
    resumeFailedRef.current = null;
    if (!autoResumeSuppressed && session.status === 'stopped') resume(sessionId);
  }, [autoResumeSuppressed, resume, session, sessionId]);

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
          resumeFailedRef.current = null;
          router.setParams({ autoResume: 'false' });
          stop(sessionId);
          const pendingResume = resumePromiseRef.current;
          if (pendingResume) void pendingResume.finally(() => stop(sessionId));
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
