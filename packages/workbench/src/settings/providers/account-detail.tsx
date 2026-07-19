import type {
  Account,
  Accounts,
  AgentKind,
  AgentRuntimes,
  ProvidersConfig,
} from '@linkcode/schema';
import { AGENT_MODEL_OPTIONS, AgentIcon, ServiceIcon } from '@linkcode/ui';
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
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from 'coss-ui/components/collapsible';
import { Menu, MenuItem, MenuPopup, MenuTrigger } from 'coss-ui/components/menu';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { Switch } from 'coss-ui/components/switch';
import { useClipboard } from 'foxact/use-clipboard';
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { bindingAvailability } from './capability';
import { serviceById } from './catalog';
import {
  AGENT_KINDS,
  accountConfigSnippet,
  accountSecret,
  boundAgentKinds,
  maskSecret,
} from './view';

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="flex items-center gap-3 border-border border-t px-3 py-2.5 first:border-t-0">
      <span className="w-24 shrink-0 text-muted-foreground text-xs">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
    </div>
  );
}

/** Right pane of the Providers page: credential, per-agent binding switches, config preview. */
export function AccountDetail({
  account,
  accounts,
  providers,
  runtimes,
  busy,
  onSetBinding,
  onSetModel,
  onEdit,
  onRemove,
}: {
  account: Account;
  accounts: Accounts;
  providers: ProvidersConfig | undefined;
  runtimes: AgentRuntimes | undefined;
  /** A providers/accounts write is in flight — hold the switches. */
  busy: boolean;
  onSetBinding: (kind: AgentKind, accountId: string | undefined) => void;
  onSetModel: (kind: AgentKind, model: string | undefined) => void;
  onEdit: () => void;
  onRemove: () => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const tAgent = useTranslations('workbench.agentKind');
  const [revealed, setRevealed] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const { copy, copied } = useClipboard();

  const service = serviceById(account.service);
  const secret = accountSecret(account);
  const bound = boundAgentKinds(providers, account.id);
  const available = AGENT_KINDS.filter(
    (kind) => bindingAvailability(account, kind).tier !== 'unavailable',
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5">
      <div className="flex items-start gap-3">
        <ServiceIcon service={account.service} label={account.label} className="size-10" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold text-base">{account.label}</h2>
          <p className="text-muted-foreground text-xs">
            {service?.label ?? t('customService')} · {credentialTypeLabel(t, account)}
          </p>
        </div>
        <Menu>
          <MenuTrigger
            render={
              <Button type="button" size="icon-sm" variant="ghost" aria-label={t('accountMenu')}>
                <MoreHorizontalIcon className="size-4" />
              </Button>
            }
          />
          <MenuPopup align="end">
            <MenuItem onClick={onEdit}>
              <PencilIcon className="size-4" />
              {t('edit')}
            </MenuItem>
            <MenuItem onClick={() => setRemoveOpen(true)}>
              <Trash2Icon className="size-4" />
              {t('remove')}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
          {t('credential')}
        </h3>
        <div className="rounded-lg border border-border">
          {account.credential.type === 'oauth' ? (
            <OauthRows agent={account.credential.agent} runtimes={runtimes} />
          ) : (
            <DetailRow label={credentialTypeLabel(t, account)}>
              <span className="min-w-0 flex-1 truncate font-mono text-sm">
                {secret === undefined ? '' : revealed ? secret : maskSecret(secret)}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={revealed ? t('hideSecret') : t('revealSecret')}
                onClick={() => setRevealed((current) => !current)}
              >
                {revealed ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t('copySecret')}
                onClick={() => {
                  if (secret !== undefined) void copy(secret);
                }}
              >
                {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
              </Button>
            </DetailRow>
          )}
          {account.endpoint ? (
            <DetailRow label={t('endpoint')}>
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
                {account.endpoint.baseUrl} · {account.endpoint.protocol}
              </span>
            </DetailRow>
          ) : null}
          {account.model !== undefined && account.model !== '' ? (
            <DetailRow label={t('accountModel')}>
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
                {account.model}
              </span>
            </DetailRow>
          ) : null}
          {account.customProvider ? (
            <DetailRow label={t('customProviderModels', { name: account.customProvider.name })}>
              <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                {account.customProvider.models.map((model) => (
                  <span
                    key={model.id}
                    className="rounded-full border border-border bg-background px-1.5 font-mono text-[10px] leading-4"
                  >
                    {model.id}
                  </span>
                ))}
              </span>
            </DetailRow>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h3 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
            {t('connections')}
          </h3>
          <span className="text-muted-foreground text-xs">
            {t('connectionsEnabled', { bound: bound.length, available: available.length })}
          </span>
        </div>
        <div className="rounded-lg border border-border">
          {AGENT_KINDS.map((kind) => (
            <BindingRow
              key={kind}
              kind={kind}
              account={account}
              accounts={accounts}
              providers={providers}
              busy={busy}
              onSetBinding={onSetBinding}
              onSetModel={onSetModel}
            />
          ))}
        </div>
      </section>

      <Collapsible>
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-muted-foreground text-xs">
          {t('configPreview')}
          <ChevronDownIcon className="size-3.5" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
            {bound.length === 0
              ? t('configPreviewEmpty')
              : accountConfigSnippet(providers, account.id)}
          </pre>
        </CollapsiblePanel>
      </Collapsible>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeTitle', { label: account.label })}</AlertDialogTitle>
            <AlertDialogDescription>
              {bound.length > 0
                ? t('removeInUse', { agents: bound.map((kind) => tAgent(kind)).join('、') })
                : t('removeHint')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline">{t('cancel')}</Button>} />
            <Button
              variant="destructive"
              onClick={() => {
                setRemoveOpen(false);
                onRemove();
              }}
            >
              {t('remove')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}

function credentialTypeLabel(
  t: ReturnType<typeof useTranslations<'settings.providers'>>,
  account: Account,
): string {
  if (account.credential.type === 'api-key') return t('credentialApiKey');
  if (account.credential.type === 'auth-token') return t('credentialAuthToken');
  return t('credentialOauth');
}

/** Credential rows for a subscription account: the delegated CLI login and its probed state. */
function OauthRows({
  agent,
  runtimes,
}: {
  agent: AgentKind;
  runtimes: AgentRuntimes | undefined;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const tAgent = useTranslations('workbench.agentKind');
  const auth = runtimes?.[agent]?.auth;
  return (
    <>
      <DetailRow label={t('credential')}>
        <span className="text-sm">{t('oauthDelegate', { agent: tAgent(agent) })}</span>
      </DetailRow>
      {auth ? (
        <DetailRow label={t('loginState')}>
          <span className="text-sm">
            {auth.loggedIn
              ? [t('loggedIn'), auth.email, auth.method, auth.subscriptionType]
                  .filter(Boolean)
                  .join(' · ')
              : t('loggedOut')}
          </span>
        </DetailRow>
      ) : null}
    </>
  );
}

function BindingRow({
  kind,
  account,
  accounts,
  providers,
  busy,
  onSetBinding,
  onSetModel,
}: {
  kind: AgentKind;
  account: Account;
  accounts: Accounts;
  providers: ProvidersConfig | undefined;
  busy: boolean;
  onSetBinding: (kind: AgentKind, accountId: string | undefined) => void;
  onSetModel: (kind: AgentKind, model: string | undefined) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const tAgent = useTranslations('workbench.agentKind');

  const availability = bindingAvailability(account, kind);
  const unavailable = availability.tier === 'unavailable';
  const boundId = providers?.[kind]?.activeAccountId;
  const bound = boundId === account.id;

  let note: string;
  if (availability.tier === 'unavailable') {
    note =
      availability.reason === 'oauth-other-agent' && account.credential.type === 'oauth'
        ? t('unavailableOauth', { agent: tAgent(account.credential.agent) })
        : availability.reason === 'translation-needs-endpoint'
          ? t('unavailableTranslationEndpoint')
          : t('unavailableProtocol');
  } else {
    const status = bound
      ? t('boundNote')
      : boundId === undefined
        ? t('noProvider')
        : t('boundElsewhere', {
            label: accounts.find((candidate) => candidate.id === boundId)?.label ?? boundId,
          });
    note = availability.tier === 'translate' ? `${t('translateNote')} · ${status}` : status;
  }

  const modelOptions = AGENT_MODEL_OPTIONS[kind];
  const currentModel = providers?.[kind]?.defaultModel ?? '';

  return (
    <div
      className={`flex items-center gap-3 border-border border-t px-3 py-2.5 first:border-t-0 ${unavailable ? 'opacity-50' : ''}`}
    >
      <AgentIcon kind={kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{tAgent(kind)}</span>
          {availability.tier === 'translate' ? (
            <Badge variant="outline">{t('translateBadge')}</Badge>
          ) : null}
        </div>
        <p className="truncate text-muted-foreground text-xs">{note}</p>
      </div>
      {bound && modelOptions ? (
        <ModelSelect
          options={
            modelOptions.some((option) => option.id === currentModel) || currentModel === ''
              ? modelOptions
              : [...modelOptions, { id: currentModel, label: currentModel }]
          }
          value={currentModel}
          disabled={busy}
          onChange={(model) => onSetModel(kind, model === '' ? undefined : model)}
        />
      ) : null}
      <Switch
        checked={bound}
        disabled={unavailable || busy}
        onCheckedChange={(checked) => onSetBinding(kind, checked ? account.id : undefined)}
      />
    </div>
  );
}

function ModelSelect({
  options,
  value,
  disabled,
  onChange,
}: {
  options: Array<{ id: string; label: string }>;
  value: string;
  disabled: boolean;
  onChange: (model: string) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const items = [
    { value: '', label: t('modelDefault') },
    ...options.map((option) => ({ value: option.id, label: option.label })),
  ];
  return (
    <Select
      items={items}
      value={value}
      disabled={disabled}
      onValueChange={(next) => onChange(typeof next === 'string' ? next : '')}
    >
      <SelectTrigger size="sm" className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
