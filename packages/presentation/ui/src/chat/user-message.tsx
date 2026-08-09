import type { ContentBlock } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import { Field, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Textarea } from 'coss-ui/components/textarea';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import { CheckIcon, ChevronDownIcon, CopyIcon, PencilIcon } from 'lucide-react';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { CommandBrandGlyph, commandBrandChipStyle } from './command-brand';
import { useCatalogCommand } from './command-catalog';
import { ContentBlockView } from './content-block-view';
import { positionalBlockEntries } from './content-derived-keys';
import { contentBlocksText } from './conversation-text';
import { Chip } from './link-chip';
import { Message, MessageAction, MessageActions, MessageContent } from './message';
import type { ConversationItem, PromptEditState } from './types';
import { useCopyButton } from './use-copy-button';

/** Long pastes collapse past this many source lines. */
const COLLAPSE_LINE_COUNT = 20;
const COPY_FEEDBACK_MS = 2000;

const RE_WHITESPACE = /\s/;

/** A command echo is exactly what the composer sent: `/name` and optional single-line argument
 * text. Multi-line arguments keep block rendering — a bare span would collapse their newlines. */
function commandEcho(text: string): { name: string; args: string } | undefined {
  if (text[0] !== '/' || text.includes('\n')) return undefined;
  const body = text.slice(1);
  const nameEnd = body.search(RE_WHITESPACE);
  if (nameEnd === 0 || body.length === 0) return undefined;
  if (nameEnd === -1) return { name: body, args: '' };
  return { name: body.slice(0, nameEnd), args: body.slice(nameEnd).trim() };
}

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

  // A catalog-matched `/command args` echo chips its invocation like the composer draft did.
  // Unknown leading slashes (paths, prose) stay plain text.
  const echo = item.blocks.length === 1 ? commandEcho(text) : undefined;
  const echoedCommand = useCatalogCommand(echo?.name);

  return (
    <Message from="user">
      <MessageContent
        className={editing ? 'w-full sm:group-data-[role=user]:max-w-full' : undefined}
      >
        {editing ? (
          <form
            className="flex min-h-36 w-full flex-col gap-3"
            onSubmit={(event) => {
              submitEdit(event).catch(noop);
            }}
          >
            <Field className="min-h-0 flex-1 gap-0" name="prompt" invalid={error !== null}>
              <FieldLabel className="sr-only">{t('editPromptLabel')}</FieldLabel>
              <Textarea
                unstyled
                aria-invalid={error !== null}
                autoFocus
                className="flex min-h-24 w-full flex-1 [&_[data-slot=textarea]]:min-h-24 [&_[data-slot=textarea]]:resize-none [&_[data-slot=textarea]]:p-0"
                disabled={pending}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.key === 'Process') return;
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeEditor();
                  }
                }}
              />
              <FieldError className="mt-2" match={error !== null}>
                {error === null
                  ? null
                  : t('editError', { message: extractErrorMessage(error, false) ?? '' })}
              </FieldError>
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                disabled={pending}
                size="sm"
                type="button"
                variant="outline"
                onClick={closeEditor}
              >
                {t('editCancel')}
              </Button>
              <Button
                disabled={pending || draft.trim().length === 0}
                loading={pending}
                size="sm"
                type="submit"
              >
                {pending ? t('editSending') : t('editSend')}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className={collapsible && !expanded ? 'line-clamp-[20]' : undefined}>
              {echo && echoedCommand ? (
                <p>
                  <Chip style={commandBrandChipStyle(echoedCommand)} variant="info">
                    <CommandBrandGlyph className="size-3.5" command={echoedCommand} />/{echo.name}
                  </Chip>
                  {echo.args ? <span className="ms-1.5">{echo.args}</span> : null}
                </p>
              ) : (
                positionalBlockEntries(item.blocks).map(({ block, key }) => (
                  <ContentBlockView key={key} block={block} />
                ))
              )}
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
          </>
        )}
      </MessageContent>
      {/* Meta row under the bubble; revealed by hovering the message. */}
      {editing ? null : (
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
      )}
    </Message>
  );
}
