import { Button } from 'coss-ui/components/button';
import { CheckIcon, ChevronDownIcon, CopyIcon, PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { ContentBlockView } from './content-block-view';
import { keyedItems, stableContentKey } from './content-keys';
import { contentBlocksText } from './conversation-text';
import { Message, MessageAction, MessageActions, MessageContent } from './message';
import type { ConversationItem } from './types';
import { useCopyButton } from './use-copy-button';

/** Long pastes collapse past this many source lines. */
const COLLAPSE_LINE_COUNT = 20;
const COPY_FEEDBACK_MS = 2000;

type MessageItem = Extract<ConversationItem, { kind: 'message' }>;

/** A user bubble: collapses long messages, with copy/edit and the send time revealed on hover. */
export function UserMessage({ item }: { item: MessageItem }): React.ReactNode {
  const t = useTranslations('workbench.message');
  const format = useFormatter();
  const [expanded, setExpanded] = useState(false);

  const text = contentBlocksText(item.blocks);
  const { copied, copyValue } = useCopyButton(text, COPY_FEEDBACK_MS);
  const collapsible = text.split('\n').length > COLLAPSE_LINE_COUNT;

  return (
    <Message from="user">
      <MessageContent>
        <div className={collapsible && !expanded ? 'line-clamp-[20]' : undefined}>
          {keyedItems(item.blocks, stableContentKey).map(({ key, item: block }) => (
            <ContentBlockView key={key} block={block} />
          ))}
        </div>
        {collapsible ? (
          <Button
            className="-ml-2 mt-1 text-muted-foreground hover:text-foreground"
            size="xs"
            type="button"
            variant="ghost"
            onClick={() => setExpanded((previous) => !previous)}
          >
            {expanded ? t('showLess') : t('showMore')}
            <ChevronDownIcon className={cn('transition-transform', expanded && 'rotate-180')} />
          </Button>
        ) : null}
      </MessageContent>
      {/* Meta row under the bubble; revealed by hovering the message. */}
      <MessageActions className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        {item.receivedAt === undefined ? null : (
          <span className="text-muted-foreground text-xs mr-1">
            {format.dateTime(new Date(item.receivedAt), { timeStyle: 'short' })}
          </span>
        )}
        <MessageAction tooltip={copied ? t('copied') : t('copy')} onClick={copyValue}>
          {copied ? <CheckIcon /> : <CopyIcon />}
        </MessageAction>
        {/* TODO(edit): disabled until message-edit / conversation-fork semantics are designed. */}
        <MessageAction disabled tooltip={t('edit')}>
          <PencilIcon />
        </MessageAction>
      </MessageActions>
    </Message>
  );
}
