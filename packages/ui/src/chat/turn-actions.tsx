import type { AgentKind } from '@linkcode/schema';
import { CheckIcon, CopyIcon, SplitIcon, ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'use-intl';
import { AgentIcon } from './agent-icon';
import { MessageAction, MessageActions } from './message';
import { useCopyButton } from './use-copy-button';

const COPY_FEEDBACK_MS = 2000;

/**
 * End-of-turn actions for an agent reply. The buttons are always visible; the provenance meta
 * (provider, model, time) reveals on hovering the row.
 */
export function AgentTurnActions({
  copyText,
  receivedAt,
  agentKind,
  modelName,
}: {
  copyText: string;
  /** Client receive time of the turn's last event (see ConversationItem.receivedAt). */
  receivedAt?: number;
  agentKind?: AgentKind;
  /** TODO(backend): no session state reflects the active model yet; hidden until one does. */
  modelName?: string;
}): React.ReactNode {
  const t = useTranslations('workbench.message');
  const format = useFormatter();
  const { copied, copyValue } = useCopyButton(copyText, COPY_FEEDBACK_MS);

  return (
    <div className="-ml-1.5 flex items-center gap-2">
      <MessageActions>
        <MessageAction tooltip={copied ? t('copied') : t('copy')} onClick={copyValue}>
          {copied ? <CheckIcon /> : <CopyIcon />}
        </MessageAction>
        {/* TODO(feedback): disabled until the data plane grows a response-feedback channel. */}
        <MessageAction disabled tooltip={t('goodResponse')}>
          <ThumbsUpIcon />
        </MessageAction>
        <MessageAction disabled tooltip={t('badResponse')}>
          <ThumbsDownIcon />
        </MessageAction>
        {/* TODO(branch): disabled until sessions support forking a conversation mid-way. */}
        <MessageAction disabled tooltip={t('branch')}>
          <SplitIcon />
        </MessageAction>
      </MessageActions>
      <div className="w-full flex items-center gap-2 text-muted-foreground text-xs opacity-0 transition-opacity group-focus-within/turn:opacity-100 group-hover/turn:opacity-100">
        {receivedAt === undefined ? null : (
          <span>{format.dateTime(new Date(receivedAt), { timeStyle: 'short' })}</span>
        )}
        <span className="flex-1" />
        {modelName ? <span className="mr-1">{modelName}</span> : null}
        {agentKind ? <AgentIcon kind={agentKind} variant="ghost" /> : null}
      </div>
    </div>
  );
}
