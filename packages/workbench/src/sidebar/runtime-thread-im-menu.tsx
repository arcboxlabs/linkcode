import type { SessionInfo } from '@linkcode/schema';
import { ThreadImMenuItems } from '@linkcode/ui';
import { useState } from 'react';
import { useCloudImActions, useCloudImBindings, useCloudImOverview } from '../cloud/im';

/** t.me deep link into a supergroup topic; Telegram drops the `-100` chat-id prefix there. */
function topicUrl(chatId: string, topicId: string | null): string | null {
  if (topicId === null) return null;
  const internal = chatId.startsWith('-100') ? chatId.slice(4) : chatId;
  return `https://t.me/c/${internal}/${topicId}`;
}

export interface RuntimeThreadImMenuProps {
  session: SessionInfo;
  /** Scopes the IM caches to the signed-in cloud account (e.g. its email); see `useCloudImOverview`. */
  accountKey: string | null | undefined;
  /** Opens Settings → IM Channel, for the not-yet-linked hand-off; injected by the app shell. */
  onOpenSettings?: () => void;
}

/**
 * Hook-backed adapter for the thread row's Telegram menu. Mounts when the row's dropdown opens,
 * so the fetches ride the shared SWR cache and only fire on first open. The app renders this
 * only when a cloud session exists (the source needs its credential).
 */
export function RuntimeThreadImMenu({
  session,
  accountKey,
  onOpenSettings,
}: RuntimeThreadImMenuProps): React.ReactNode {
  const overview = useCloudImOverview(accountKey);
  const linked = (overview.data?.accounts.length ?? 0) > 0;
  const bindings = useCloudImBindings(linked ? accountKey : null);
  const actions = useCloudImActions();
  const [pending, setPending] = useState(false);

  const row = bindings.data?.find((binding) => binding.sessionId === session.sessionId);
  // undefined = still loading; null = definitively unbound.
  const binding =
    overview.data === undefined || (linked && bindings.data === undefined)
      ? undefined
      : row === undefined
        ? null
        : { pushOut: row.pushOut, url: topicUrl(row.chatId, row.topicId) };

  function run(task: () => Promise<unknown>): void {
    setPending(true);
    void task().finally(() => setPending(false));
  }

  return (
    <ThreadImMenuItems
      // While the overview is loading, render the loading item rather than the connect hand-off.
      linked={overview.data === undefined ? true : linked}
      binding={binding}
      chats={overview.data?.chats ?? []}
      pending={pending}
      onOpenBinding={() => {
        if (binding && binding.url !== null) window.open(binding.url, '_blank');
      }}
      onCreateBinding={(chatId) => {
        if (!actions) return;
        run(async () => {
          const result = await actions.createBinding({
            sessionId: session.sessionId,
            chatId,
            title: session.title,
            kind: session.kind,
            historyId: session.historyId,
          });
          if (result.ok) {
            const url = topicUrl(result.chatId, result.topicId);
            if (url !== null) window.open(url, '_blank');
          }
        });
      }}
      onTogglePush={(pushOut) => {
        if (!actions) return;
        run(() => actions.setBindingPush(session.sessionId, pushOut));
      }}
      onUnbind={() => {
        if (!actions) return;
        run(() => actions.deleteBinding(session.sessionId));
      }}
      onOpenSettings={onOpenSettings}
    />
  );
}
