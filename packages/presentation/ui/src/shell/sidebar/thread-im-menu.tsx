import type { SessionInfo } from '@linkcode/schema';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from 'coss-ui/components/menu';
import { Link2OffIcon, SendIcon, SettingsIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';

/** Adapter contract for the thread row's IM menu (workbench `RuntimeThreadImMenu`, rendering
 * {@link ThreadImMenuItems}). Lives inside the row's dropdown popup — must emit menu items only. */
export type ThreadImMenuComponentType = React.ComponentType<{ session: SessionInfo }>;

export interface ThreadImMenuChatView {
  chatId: string;
  title: string | null;
}

export interface ThreadImMenuItemsProps {
  /** Telegram account linked? When false only the settings hand-off renders. */
  linked: boolean;
  /** Binding state: undefined while loading, null when the session is unbound. */
  binding: { pushOut: boolean; url: string | null } | null | undefined;
  /** Linked chats a new binding can target (chooser renders when there are several). */
  chats: ThreadImMenuChatView[];
  /** True while a mutation is in flight; items disable to prevent double fires. */
  pending: boolean;
  onOpenBinding: () => void;
  onCreateBinding: (chatId: string) => void;
  onTogglePush: (pushOut: boolean) => void;
  onUnbind: () => void;
  /** Opens Settings → IM Channel (to link an account). Omit to hide the hand-off. */
  onOpenSettings?: () => void;
}

/** Menu items for one thread's Telegram wiring (open topic / push toggle / unbind). */
export function ThreadImMenuItems({
  linked,
  binding,
  chats,
  pending,
  onOpenBinding,
  onCreateBinding,
  onTogglePush,
  onUnbind,
  onOpenSettings,
}: ThreadImMenuItemsProps): React.ReactNode {
  const t = useTranslations('workbench.sidebar.im');

  if (!linked) {
    return (
      <DropdownMenuItem disabled={!onOpenSettings} onClick={onOpenSettings}>
        <SettingsIcon />
        {t('connect')}
      </DropdownMenuItem>
    );
  }
  if (binding === undefined) {
    return <DropdownMenuItem disabled>{t('loading')}</DropdownMenuItem>;
  }

  if (binding === null) {
    if (chats.length > 1) {
      return (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={pending}>
            <SendIcon />
            {t('open')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {chats.map((chat) => (
              <DropdownMenuItem key={chat.chatId} onClick={() => onCreateBinding(chat.chatId)}>
                {chat.title ?? t('groupFallback', { id: chat.chatId })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      );
    }
    const only = chats.at(0);
    return (
      <DropdownMenuItem
        disabled={pending || only === undefined}
        onClick={only === undefined ? undefined : () => onCreateBinding(only.chatId)}
      >
        <SendIcon />
        {t('open')}
      </DropdownMenuItem>
    );
  }

  return (
    <>
      <DropdownMenuItem disabled={binding.url === null} onClick={onOpenBinding}>
        <SendIcon />
        {t('open')}
      </DropdownMenuItem>
      <DropdownMenuCheckboxItem
        checked={binding.pushOut}
        disabled={pending}
        onCheckedChange={(checked) => onTogglePush(checked)}
      >
        {t('push')}
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" disabled={pending} onClick={onUnbind}>
        <Link2OffIcon />
        {t('unbind')}
      </DropdownMenuItem>
    </>
  );
}
