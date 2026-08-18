import { useSessions } from '@linkcode/client-core';
import type { SessionId, ToolCall } from '@linkcode/schema';
import { SessionIdSchema } from '@linkcode/schema';
import {
  AGENT_LABELS,
  EFFORT_OPTIONS_BY_ID,
  EmptyState,
  effortOptionsForModel,
  modelChoiceKey,
  repositoryLabel,
  resolveModel,
  selectCurrentPlan,
  selectPendingPromptItems,
} from '@linkcode/ui/native';
import { Composer } from '@mobile/components/conversation/composer';
import { PromptDock } from '@mobile/components/conversation/prompt-dock/prompt-dock';
import { SessionTitle } from '@mobile/components/conversation/session-title';
import {
  SessionApprovalChip,
  SessionSelectorChip,
} from '@mobile/components/conversation/session-tools';
import { TimelineItem } from '@mobile/components/conversation/timeline-item';
import { ToolDetailSheet } from '@mobile/components/conversation/tool-detail-sheet/tool-detail-sheet';
import { HostClientGate } from '@mobile/components/host/host-client-gate';
import { HeaderMenuButton } from '@mobile/components/shell/header-menu-button';
import { USES_IOS_26_NAVIGATION } from '@mobile/components/shell/ios-26-navigation';
import { VISIBLE_HEADER_OPTIONS } from '@mobile/components/shell/use-stack-screen-options';
import { useAccountModels } from '@mobile/runtime/use-account-models';
import { useSeededConversation } from '@mobile/runtime/use-seeded-conversation';
import { useSessionActions } from '@mobile/runtime/use-session-actions';
import { useSessionAutoResume } from '@mobile/runtime/use-session-auto-resume';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { noop } from 'foxact/noop';
import { useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslations } from 'use-intl';

/** A thread is a screen of the host stack, not of a tab, so it covers the tab bar and the composer
 * owns the bottom edge. The gate lives here rather than in a `session/_layout` because another
 * navigator there would make this the root of its own stack and strip its back button. */
export default function SessionRoute(): React.ReactNode {
  return (
    <HostClientGate>
      <SessionScreen />
    </HostClientGate>
  );
}

/** Conversation view of one session running on the host, with the composer that drives it and
 * the prompt dock that answers its asks. The inverted list pins to the newest item and leaves
 * the user's scroll position alone while output streams. */
function SessionScreen(): React.ReactNode {
  const t = useTranslations('mobile.conversation');
  const tChat = useTranslations('mobile.chat');
  const tSettings = useTranslations('mobile.settings');
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const router = useRouter();
  const { sessionId: rawSessionId, autoResume } = useLocalSearchParams<{
    sessionId: string;
    autoResume?: string;
  }>();
  const autoResumeSuppressed = autoResume === 'false';
  const parsed = SessionIdSchema.safeParse(rawSessionId);
  const sessionId: SessionId | null = parsed.success ? parsed.data : null;
  const { sessionsById, refresh } = useSessions();

  const session = sessionId === null ? undefined : sessionsById.get(sessionId);
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
  // Measured height of the floating composer block, fed back to the list as its bottom inset so
  // resting content clears the card while scrolling still flows under the glass.
  const [dockHeight, setDockHeight] = useState(0);

  const title = session
    ? (session.title ?? `${AGENT_LABELS[session.kind]} in ${repositoryLabel(session.cwd)}`)
    : '';

  // Composer tools mirror the desktop live composer: account-backed models, effort options for
  // the model the session actually runs on, and the adapter-advertised policies — all values
  // server-reflected off the conversation, never held locally.
  const models = useAccountModels(session?.kind ?? null);
  const currentModelOption = resolveModel(
    models ?? undefined,
    conversation.currentModel,
    session?.accountId,
  );
  const effortOptions = session
    ? effortOptionsForModel(
        session.kind,
        resolveModel(conversation.availableModels ?? undefined, conversation.currentModel),
      )
    : undefined;
  const selectorValue = [
    currentModelOption?.label ??
      conversation.currentModel ??
      (session ? AGENT_LABELS[session.kind] : ''),
    ...(conversation.currentEffort
      ? [EFFORT_OPTIONS_BY_ID[conversation.currentEffort].shortLabel]
      : []),
  ].join(' · ');

  const prompts = selectPendingPromptItems(conversation);
  const plan = selectCurrentPlan(conversation);
  const openToolCall: ToolCall | null =
    conversation.items.findLast(
      (item): item is typeof item & { kind: 'tool' } =>
        item.kind === 'tool' && item.toolCall.toolCallId === openToolCallId,
    )?.toolCall ?? null;

  const stopThread = (): void => {
    router.setParams({ autoResume: 'false' });
    stop();
  };
  const copyThreadId = (): void => {
    if (sessionId) void Clipboard.setStringAsync(sessionId);
  };

  // Inverted list: index 0 renders at the visual bottom, so newest items pin there.
  const reversed = [...conversation.items].reverse();

  return (
    <View
      className="flex-1 bg-background"
      style={{ paddingBottom: USES_IOS_26_NAVIGATION ? 0 : insets.bottom }}
    >
      <Stack.Screen
        options={{
          ...VISIBLE_HEADER_OPTIONS,
          title,
          headerTitle: () => <SessionTitle title={title} status={conversation.status} />,
          ...(process.env.EXPO_OS === 'ios'
            ? {
                unstable_headerRightItems: () => [
                  {
                    type: 'menu',
                    label: tSettings('more'),
                    icon: { type: 'sfSymbol', name: 'ellipsis' },
                    menu: {
                      items: [
                        {
                          type: 'action',
                          label: tChat('copyThreadId'),
                          icon: { type: 'sfSymbol', name: 'doc.on.doc' },
                          onPress: copyThreadId,
                        },
                        {
                          type: 'action',
                          label: tChat('stopThread'),
                          icon: { type: 'sfSymbol', name: 'stop.circle' },
                          destructive: true,
                          onPress: stopThread,
                        },
                      ],
                    },
                  },
                ],
              }
            : {
                headerRight: () => (
                  <HeaderMenuButton
                    label={tSettings('more')}
                    actions={[
                      { id: 'copy', label: tChat('copyThreadId'), onPress: copyThreadId },
                      {
                        id: 'stop',
                        label: tChat('stopThread'),
                        destructive: true,
                        onPress: stopThread,
                      },
                    ]}
                  />
                ),
              }),
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
          ListFooterComponent={
            process.env.EXPO_OS === 'ios' ? <View style={{ height: headerHeight }} /> : null
          }
          // Inverted list: the header renders at the visual bottom — the clearance that keeps
          // resting content out from under the floating composer.
          ListHeaderComponent={
            USES_IOS_26_NAVIGATION && dockHeight > 0 ? (
              <View style={{ height: dockHeight }} />
            ) : null
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}
          className="flex-1"
        />
      )}
      {/* Sticky rather than an avoiding view: the inverted list already pins to the bottom, so
          the composer only has to ride the keyboard instead of resizing the whole screen. On
          iOS 26 the block floats over the list so content scrolls under the glass. */}
      <View
        className={USES_IOS_26_NAVIGATION ? 'absolute inset-x-0 bottom-0' : undefined}
        style={USES_IOS_26_NAVIGATION ? { paddingBottom: insets.bottom } : undefined}
        pointerEvents="box-none"
        onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}
      >
        <KeyboardStickyView>
          <PromptDock
            prompts={prompts}
            plan={plan}
            respondingIds={actions.respondingIds}
            onRespondPermission={actions.respondPermission}
            onRespondQuestion={actions.respondQuestion}
          />
          <Composer
            text={actions.text}
            onTextChange={actions.setText}
            sendBlocked={actions.sending}
            onSend={actions.send}
            onStop={actions.stop}
            isRunning={actions.isRunning}
            disabled={!actions.canCompose}
            error={
              actions.failure
                ? t(
                    actions.failure === 'send'
                      ? 'sendError'
                      : actions.failure === 'stop'
                        ? 'stopError'
                        : 'controlError',
                  )
                : undefined
            }
            tools={
              <SessionApprovalChip
                approvalPolicy={conversation.approvalPolicy}
                onPolicyChange={actions.setApprovalPolicy}
              />
            }
            trailing={
              session ? (
                <SessionSelectorChip
                  kind={session.kind}
                  selectorValue={selectorValue}
                  models={models}
                  currentModelKey={currentModelOption ? modelChoiceKey(currentModelOption) : null}
                  onModelChange={actions.setModel}
                  effortOptions={effortOptions}
                  currentEffort={conversation.currentEffort}
                  onEffortChange={actions.setEffort}
                />
              ) : undefined
            }
          />
        </KeyboardStickyView>
      </View>
      <ToolDetailSheet toolCall={openToolCall} onDismiss={() => setOpenToolCallId(null)} />
    </View>
  );
}
