import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from 'coss-ui/components/alert-dialog';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Field, FieldDescription, FieldLabel } from 'coss-ui/components/field';
import { Input } from 'coss-ui/components/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { Skeleton } from 'coss-ui/components/skeleton';
import { Switch } from 'coss-ui/components/switch';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { ExternalLinkIcon, SendIcon } from 'lucide-react';
import { useState } from 'react';
import { useFormatter, useTranslations } from 'use-intl';

export interface ImChannelAccountView {
  /** Platform-side user id (Telegram numeric id as a string). */
  accountId: string;
  /** ISO timestamp. */
  linkedAt: string;
}

export interface ImChannelChatView {
  chatId: string;
  title: string | null;
}

export interface ImChannelBindingView {
  sessionId: string;
  /** Resolved chat title, or null when the chat is unknown. */
  chatTitle: string | null;
  topicId: string;
  state: 'live' | 'muted';
  /** Epoch millis. */
  updatedAt: number;
}

export type ImChannelLinkOutcome = 'linked' | 'not-found' | 'conflict' | 'error';

export interface ImChannelPreferencesView {
  autoMirror: boolean;
  /** Target chat for auto-created topics; required while autoMirror is on. */
  chatId: string | null;
}

const LINK_FAILURE_KEY = {
  'not-found': 'linkErrorNotFound',
  conflict: 'linkErrorConflict',
  error: 'linkErrorGeneric',
} as const;

export interface ImChannelSettingsPanelProps {
  signedIn: boolean;
  /** Hands off to the cloud sign-in flow; omit to render the gate without a button. */
  onSignIn?: () => void;
  /** The linked Telegram account: undefined while loading, null when none is linked. */
  account: ImChannelAccountView | null | undefined;
  /** Set when the overview failed to load and there is no data to show. */
  overviewError: string | null;
  chats: ImChannelChatView[];
  /** undefined while loading. */
  bindings: ImChannelBindingView[] | undefined;
  /** The shared bot's username for t.me links, when the server exposes it. */
  botUsername: string | null;
  /** undefined while loading; the auto-mirror section renders a skeleton then. */
  preferences: ImChannelPreferencesView | undefined;
  onLinkSubmit: (code: string) => Promise<ImChannelLinkOutcome>;
  onUnlink: () => Promise<void>;
  onPreferencesChange: (pref: ImChannelPreferencesView) => Promise<void>;
}

/** IM Channel settings (link/inspect/disconnect a Telegram account). Business-free — all data
 * and mutations arrive via props from the app's container. */
export function ImChannelSettingsPanel({
  signedIn,
  onSignIn,
  account,
  overviewError,
  chats,
  bindings,
  botUsername,
  preferences,
  onLinkSubmit,
  onUnlink,
  onPreferencesChange,
}: ImChannelSettingsPanelProps): React.ReactNode {
  const t = useTranslations('settings.imChannel');

  let body: React.ReactNode;
  if (!signedIn) {
    body = (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">{t('signedOut')}</p>
        {onSignIn && (
          <Button size="sm" onClick={onSignIn}>
            {t('signIn')}
          </Button>
        )}
      </div>
    );
  } else if (overviewError !== null && account === undefined) {
    body = <p className="text-destructive text-sm">{t('loadError', { message: overviewError })}</p>;
  } else if (account === undefined) {
    body = (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  } else if (account === null) {
    body = <ConnectTelegramSection botUsername={botUsername} onLinkSubmit={onLinkSubmit} />;
  } else {
    body = (
      <>
        <LinkedAccountSection account={account} chats={chats} onUnlink={onUnlink} />
        <AutoMirrorSection
          chats={chats}
          preferences={preferences}
          onPreferencesChange={onPreferencesChange}
        />
        <BindingsSection bindings={bindings} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* The page title is rendered by the settings shell; this is the lead subtitle. */}
      <p className="text-muted-foreground text-sm">{t('hint')}</p>
      {body}
    </div>
  );
}

function ConnectTelegramSection({
  botUsername,
  onLinkSubmit,
}: {
  botUsername: string | null;
  onLinkSubmit: (code: string) => Promise<ImChannelLinkOutcome>;
}): React.ReactNode {
  const t = useTranslations('settings.imChannel');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Exclude<ImChannelLinkOutcome, 'linked'> | null>(null);

  function submit(): void {
    const trimmed = code.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setFailure(null);
    void onLinkSubmit(trimmed)
      .then((outcome) => {
        if (outcome === 'linked') setCode('');
        else setFailure(outcome);
      })
      .finally(() => setPending(false));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="flex items-center gap-1.5 font-medium text-sm">
          <SendIcon className="size-4" />
          {t('connectTitle')}
        </h3>
        <ol className="mt-2 list-inside list-decimal space-y-1 text-muted-foreground text-xs">
          <li>{t('connectStep1')}</li>
          <li>{t('connectStep2')}</li>
          <li>{t('connectStep3')}</li>
        </ol>
        {botUsername !== null && (
          <a
            className="mt-2 inline-flex items-center gap-1 text-primary text-xs hover:underline"
            href={`https://t.me/${botUsername}`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLinkIcon className="size-3" />
            {t('openBot', { username: botUsername })}
          </a>
        )}
      </div>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field>
          <FieldLabel>{t('codeLabel')}</FieldLabel>
          <Input
            className="w-56 font-mono uppercase"
            placeholder={t('codePlaceholder')}
            spellCheck={false}
            autoComplete="off"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          {failure !== null && (
            <FieldDescription className="text-destructive">
              {t(LINK_FAILURE_KEY[failure])}
            </FieldDescription>
          )}
        </Field>
        <div>
          <Button type="submit" size="sm" disabled={pending || code.trim() === ''}>
            {t('confirm')}
          </Button>
        </div>
      </form>
    </div>
  );
}

function LinkedAccountSection({
  account,
  chats,
  onUnlink,
}: {
  account: ImChannelAccountView;
  chats: ImChannelChatView[];
  onUnlink: () => Promise<void>;
}): React.ReactNode {
  const t = useTranslations('settings.imChannel');
  const format = useFormatter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unlinkPending, setUnlinkPending] = useState(false);
  const [unlinkError, setUnlinkError] = useState<unknown>(null);

  function confirmUnlink(): void {
    setUnlinkPending(true);
    setUnlinkError(null);
    void onUnlink()
      .then(() => setConfirmOpen(false))
      .catch((err: unknown) => setUnlinkError(err))
      .finally(() => setUnlinkPending(false));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-medium text-sm">{t('linkedAccount')}</h3>
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <SendIcon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="truncate text-sm">{t('linkedAs', { id: account.accountId })}</div>
              <div className="text-muted-foreground text-xs">
                {t('linkedAt', {
                  date: format.dateTime(new Date(account.linkedAt), { dateStyle: 'medium' }),
                })}
              </div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
            {t('disconnect')}
          </Button>
        </div>
      </div>
      {chats.length > 0 && (
        <div>
          <h3 className="font-medium text-sm">{t('chats')}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {chats.map((chat) => (
              <li key={chat.chatId} className="truncate text-muted-foreground">
                {chat.title ?? t('chatFallback', { id: chat.chatId })}
              </li>
            ))}
          </ul>
        </div>
      )}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('disconnectTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('disconnectDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          {unlinkError != null && (
            <div className="px-6 pb-4 text-destructive text-xs">
              {t('loadError', { message: extractErrorMessage(unlinkError, false) ?? '' })}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline">{t('cancel')}</Button>} />
            <Button variant="destructive" disabled={unlinkPending} onClick={confirmUnlink}>
              {t('disconnectConfirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

function AutoMirrorSection({
  chats,
  preferences,
  onPreferencesChange,
}: {
  chats: ImChannelChatView[];
  preferences: ImChannelPreferencesView | undefined;
  onPreferencesChange: (pref: ImChannelPreferencesView) => Promise<void>;
}): React.ReactNode {
  const t = useTranslations('settings.imChannel');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function apply(pref: ImChannelPreferencesView): void {
    setPending(true);
    setError(null);
    void onPreferencesChange(pref)
      .catch((err: unknown) => setError(err))
      .finally(() => setPending(false));
  }

  const chatItems = chats.map((chat) => ({
    value: chat.chatId,
    label: chat.title ?? t('chatFallback', { id: chat.chatId }),
  }));
  const targetChatId = preferences?.chatId ?? chats.at(0)?.chatId ?? null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-medium text-sm">{t('autoMirror')}</h3>
          <p className="text-muted-foreground text-xs">{t('autoMirrorHint')}</p>
        </div>
        {preferences === undefined ? (
          <Skeleton className="h-5 w-9 rounded-full" />
        ) : (
          <Switch
            checked={preferences.autoMirror}
            disabled={pending || (targetChatId === null && !preferences.autoMirror)}
            onCheckedChange={(checked) => {
              apply({ autoMirror: checked, chatId: targetChatId });
            }}
          />
        )}
      </div>
      {preferences?.autoMirror && chats.length > 1 && (
        <Field className="mt-3">
          <FieldLabel>{t('autoMirrorTarget')}</FieldLabel>
          <Select
            items={chatItems}
            value={targetChatId ?? ''}
            onValueChange={(value) => {
              apply({ autoMirror: true, chatId: String(value) });
            }}
          >
            <SelectTrigger className="mt-1 w-64" disabled={pending}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {chatItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
      )}
      {error != null && (
        <p className="mt-2 text-destructive text-xs">
          {t('loadError', { message: extractErrorMessage(error, false) ?? '' })}
        </p>
      )}
    </div>
  );
}

function BindingsSection({
  bindings,
}: {
  bindings: ImChannelBindingView[] | undefined;
}): React.ReactNode {
  const t = useTranslations('settings.imChannel');
  const format = useFormatter();

  return (
    <div>
      <h3 className="font-medium text-sm">{t('bindings')}</h3>
      {bindings === undefined ? (
        <Skeleton className="mt-2 h-9 w-full" />
      ) : bindings.length === 0 ? (
        <p className="mt-2 text-muted-foreground text-xs">{t('bindingsEmpty')}</p>
      ) : (
        <ul className="mt-2 divide-y rounded-lg border">
          {bindings.map((binding) => (
            <li
              key={binding.sessionId}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm">
                  {binding.chatTitle ?? t('chatFallback', { id: binding.topicId })}
                </div>
                <div className="truncate text-muted-foreground text-xs">
                  {t('bindingSession', { id: binding.sessionId.slice(0, 8) })}
                  {' · '}
                  {format.dateTime(new Date(binding.updatedAt), {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </div>
              </div>
              <Badge variant={binding.state === 'live' ? 'default' : 'secondary'}>
                {t(binding.state === 'live' ? 'stateLive' : 'stateMuted')}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
