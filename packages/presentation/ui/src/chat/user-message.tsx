import type { ContentBlock } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from 'coss-ui/components/dialog';
import { Field, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Textarea } from 'coss-ui/components/textarea';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import { CheckIcon, ChevronDownIcon, CopyIcon, PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { ContentBlockView } from './content-block-view';
import { positionalBlockEntries } from './content-derived-keys';
import { contentBlocksText } from './conversation-text';
import { Message, MessageAction, MessageActions, MessageContent } from './message';
import type { ConversationItem, PromptEditState } from './types';
import { useCopyButton } from './use-copy-button';

/** Long pastes collapse past this many source lines. */
const COLLAPSE_LINE_COUNT = 20;
const COPY_FEEDBACK_MS = 2000;

type MessageItem = Extract<ConversationItem, { kind: 'message' }>;

/** A user bubble: collapses long messages, with copy/edit and the send time revealed on hover. */
export function UserMessage({
  item,
  promptEditState = 'unsupported',
  onEditPrompt,
}: {
  item: MessageItem;
  promptEditState?: PromptEditState;
  onEditPrompt?: (
    messageId: string,
    branchCursor: string,
    content: ContentBlock[],
  ) => Promise<void>;
}): React.ReactNode {
  const t = useTranslations('workbench.message');
  const format = useFormatter();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const text = contentBlocksText(item.blocks);
  const { copied, copyValue } = useCopyButton(text, COPY_FEEDBACK_MS);
  const collapsible = text.split('\n').length > COLLAPSE_LINE_COUNT;
  const canEdit =
    promptEditState === 'enabled' && item.branchCursor !== undefined && onEditPrompt !== undefined;
  const editTooltip =
    item.branchCursor === undefined
      ? t('editUnavailable')
      : promptEditState === 'busy'
        ? t('editBusy')
        : promptEditState === 'unsupported'
          ? t('editUnsupported')
          : t('edit');

  function openEditor(): void {
    if (!canEdit) return;
    setDraft(text);
    setError(null);
    setEditing(true);
  }

  function closeEditor(): void {
    if (pending) return;
    setEditing(false);
    setError(null);
  }

  async function submitEdit(
    event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>,
  ): Promise<void> {
    event.preventDefault();
    if (!canEdit || draft.trim().length === 0 || item.branchCursor === undefined) return;
    setPending(true);
    setError(null);
    const retainedBlocks = item.blocks.filter((block) => block.type !== 'text');
    try {
      await onEditPrompt(item.id, item.branchCursor, [
        { type: 'text', text: draft },
        ...retainedBlocks,
      ]);
      setEditing(false);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setPending(false);
    }
  }

  return (
    <Message from="user">
      <MessageContent>
        <div className={collapsible && !expanded ? 'line-clamp-[20]' : undefined}>
          {positionalBlockEntries(item.blocks).map(({ block, key }) => (
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
        <MessageAction disabled={!canEdit} tooltip={editTooltip} onClick={openEditor}>
          <PencilIcon />
        </MessageAction>
      </MessageActions>
      <Dialog
        open={editing}
        disablePointerDismissal={pending}
        onOpenChange={(open) => {
          if (!open) closeEditor();
        }}
      >
        <DialogPopup className="max-w-lg" closeProps={{ disabled: pending }}>
          <DialogHeader>
            <DialogTitle>{t('editDialogTitle')}</DialogTitle>
            <DialogDescription>{t('editDialogDescription')}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              submitEdit(event).catch(noop);
            }}
          >
            <DialogPanel>
              <Field name="prompt" invalid={error !== null}>
                <FieldLabel>{t('editPromptLabel')}</FieldLabel>
                <Textarea
                  aria-invalid={error !== null}
                  autoFocus
                  className="min-h-40 resize-y"
                  disabled={pending}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setError(null);
                  }}
                />
                <p className="text-muted-foreground text-xs">{t('editFileStateWarning')}</p>
                <FieldError match={error !== null}>
                  {error === null
                    ? null
                    : t('editError', { message: extractErrorMessage(error, false) ?? '' })}
                </FieldError>
              </Field>
            </DialogPanel>
            <DialogFooter variant="bare">
              <Button
                disabled={pending}
                size="sm"
                type="button"
                variant="ghost"
                onClick={closeEditor}
              >
                {t('editCancel')}
              </Button>
              <Button disabled={pending || draft.trim().length === 0} size="sm" type="submit">
                {pending ? t('editCreating') : t('editCreate')}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </Message>
  );
}
