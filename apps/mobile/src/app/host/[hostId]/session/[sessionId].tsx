import { useLinkCodeClient, useSessions } from '@linkcode/client-core';
import type { SessionId, ToolCall } from '@linkcode/schema';
import { SessionIdSchema } from '@linkcode/schema';
import {
  AGENT_LABELS,
  AgentIcon,
  Composer,
  ConversationList,
  EmptyState,
  PromptDock,
  ToolDetailSheet,
} from '@linkcode/ui/native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { noop } from 'foxts/noop';
import { ChevronLeft, Ellipsis } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import { useTranslations } from 'use-intl';
import { useConversationActions } from '../../../../hooks/use-conversation-actions';
import { useSeededConversation } from '../../../../hooks/use-seeded-conversation';

function repositoryLabel(cwd: string): string {
  return cwd.split('/').findLast((part) => part.length > 0) ?? cwd;
}

/** The conversation screen: seeded timeline + prompt dock + composer (design M1). */
export default function SessionScreen(): React.ReactNode {
  const t = useTranslations('mobile.chat');
  const tConversation = useTranslations('mobile.conversation');
  const tStatus = useTranslations('mobile.sessions.status');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = useLinkCodeClient();
  const mutedColor = String(useCSSVariable('--muted'));

  const { sessionId: rawSessionId } = useLocalSearchParams<{ sessionId: string }>();
  const parsed = SessionIdSchema.safeParse(rawSessionId);
  const sessionId: SessionId | null = parsed.success ? parsed.data : null;

  const { sessions } = useSessions();
  const info = sessions.find((session) => session.sessionId === sessionId) ?? null;

  const conversation = useSeededConversation(info);
  const actions = useConversationActions(sessionId);

  const [draft, setDraft] = useState('');
  const [sendFailed, setSendFailed] = useState(false);
  const [openToolCallId, setOpenToolCallId] = useState<string | null>(null);
  const resumedRef = useRef(false);

  // The daemon re-broadcasts open asks to attachers — a reopened app regains pending approvals.
  useFocusEffect(
    useCallback(() => {
      if (sessionId) client.attachSession(sessionId);
    }, [client, sessionId]),
  );

  // Desktop parity (`applySelection`): opening a stopped session resumes it silently, once.
  useEffect(() => {
    if (!sessionId || info?.status !== 'stopped' || resumedRef.current) return;
    resumedRef.current = true;
    client.resumeSession(sessionId).catch((error: unknown) => {
      console.warn('[mobile] auto-resume failed', error);
    });
  }, [client, sessionId, info?.status]);

  const status = conversation.status ?? info?.status ?? 'starting';
  const running = status === 'running' || status === 'starting';
  const agentKind = info?.kind;
  const title =
    info?.title ?? (info ? `${AGENT_LABELS[info.kind]} · ${repositoryLabel(info.cwd)}` : '');

  const answered = new Set(actions.answeredRequestIds);
  const approvals = conversation.items.flatMap((item) =>
    item.kind === 'approval' &&
    conversation.pendingPermissionIds.includes(item.requestId) &&
    !answered.has(item.requestId)
      ? [{ requestId: item.requestId, toolCall: item.toolCall, options: item.options }]
      : [],
  );
  const questions = conversation.items.flatMap((item) =>
    item.kind === 'question' &&
    conversation.pendingQuestionIds.includes(item.requestId) &&
    !answered.has(item.requestId)
      ? [{ requestId: item.requestId, questions: item.questions }]
      : [],
  );
  const plan = conversation.items.findLast((item) => item.kind === 'plan')?.plan ?? null;
  const openToolCall: ToolCall | null =
    conversation.items.findLast(
      (item): item is typeof item & { kind: 'tool' } =>
        item.kind === 'tool' && item.toolCall.toolCallId === openToolCallId,
    )?.toolCall ?? null;

  const showMenu = (): void => {
    if (!sessionId) return;
    Alert.alert(title, undefined, [
      {
        text: t('stopThread'),
        style: 'destructive',
        onPress() {
          void client.stopSession(sessionId).catch(noop);
        },
      },
      { text: t('copyThreadId'), onPress: () => actions.copyText(sessionId) },
      { text: t('cancel'), style: 'cancel' },
    ]);
  };

  const handleSend = async (text: string): Promise<void> => {
    setSendFailed(false);
    setDraft('');
    const ok = await actions.send(text);
    if (!ok) {
      setDraft((current) => (current.length === 0 ? text : current));
      setSendFailed(true);
    }
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-2.5 border-border/60 border-b px-2 pb-2">
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          className="size-10 items-center justify-center"
        >
          <ChevronLeft size={22} color={mutedColor} />
        </Pressable>
        {agentKind ? (
          <AgentIcon kind={agentKind} status={status} statusLabel={tStatus(status)} />
        ) : null}
        <Text
          className="flex-1 text-[14px] text-foreground"
          style={{ fontWeight: '600' }}
          numberOfLines={1}
        >
          {title}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('stop')}
          onPress={showMenu}
          className="size-10 items-center justify-center"
        >
          <Ellipsis size={18} color={mutedColor} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {conversation.items.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <EmptyState title={tConversation('emptyTitle')} hint={tConversation('emptyHint')} />
          </View>
        ) : (
          <ConversationList
            items={conversation.items}
            onPressTool={(toolCall) => setOpenToolCallId(toolCall.toolCallId)}
            onCopyText={actions.copyText}
            declinedRequestIds={actions.declinedRequestIds}
          />
        )}

        <PromptDock
          approvals={approvals}
          questions={questions}
          plan={plan}
          respondingRequestId={actions.respondingRequestId}
          respondingOptionId={actions.respondingOptionId}
          onRespondPermission={(requestId, outcome) => {
            const approval = approvals.find((entry) => entry.requestId === requestId);
            const declined =
              outcome.outcome === 'selected' &&
              (approval?.options.find((option) => option.optionId === outcome.optionId)?.kind ===
                'reject_once' ||
                approval?.options.find((option) => option.optionId === outcome.optionId)?.kind ===
                  'reject_always');
            actions.respondPermission(requestId, outcome, declined);
          }}
          onRespondQuestion={(requestId, outcome) => actions.respondQuestion(requestId, outcome)}
        />

        {sendFailed ? (
          <Text className="px-5 pb-1 text-[12px] text-danger">{t('sendFailed')}</Text>
        ) : null}
        <View className="px-3" style={{ paddingBottom: insets.bottom + 6 }}>
          <Composer
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              if (sendFailed) setSendFailed(false);
            }}
            placeholder={
              agentKind
                ? t('placeholder', { agent: AGENT_LABELS[agentKind] })
                : t('placeholder', { agent: '' })
            }
            running={running}
            onSend={(text) => {
              void handleSend(text);
            }}
            onStop={actions.stop}
          />
        </View>
      </KeyboardAvoidingView>

      <ToolDetailSheet toolCall={openToolCall} onDismiss={() => setOpenToolCallId(null)} />
    </View>
  );
}
