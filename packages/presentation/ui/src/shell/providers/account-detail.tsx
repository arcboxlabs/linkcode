import type { AgentKind } from '@linkcode/schema';
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
import { AgentIcon } from '../../chat/agent-icon';
import { AGENT_MODEL_OPTIONS } from '../agent-models';
import { ServiceIcon } from '../service-icon';

export type ProviderBindingStatus =
  | { kind: 'unavailable-oauth'; agent: AgentKind }
  | { kind: 'unavailable-translation-endpoint' }
  | { kind: 'unavailable-protocol' }
  | { kind: 'bound' }
  | { kind: 'no-provider' }
  | { kind: 'bound-elsewhere'; accountLabel: string };

export interface ProviderBindingViewModel {
  kind: AgentKind;
  tier: 'native' | 'translate' | 'unavailable';
  status: ProviderBindingStatus;
  bound: boolean;
  currentModel: string;
}

export type ProviderCredentialViewModel =
  | {
      kind: 'secret';
      type: 'api-key' | 'auth-token';
      value: string;
      maskedValue: string;
    }
  | {
      kind: 'oauth';
      agent: AgentKind;
      auth?: { loggedIn: boolean; details: string[] };
    };

export interface ProviderAccountDetailViewModel {
  id: string;
  service?: string;
  serviceLabel?: string;
  label: string;
  credential: ProviderCredentialViewModel;
  endpoint?: { baseUrl: string; protocol: string };
  accountModel?: string;
  /** Account-defined provider models (CODE-312), shown read-only when the account carries a
   * `customProvider` definition. */
  customProvider?: { name: string; models: ReadonlyArray<{ id: string }> };
  bindings: ProviderBindingViewModel[];
  boundAgents: AgentKind[];
  availableBindingCount: number;
  configPreview?: string;
}

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
  busy,
  onSetBinding,
  onSetModel,
  onEdit,
  onRemove,
}: {
  account: ProviderAccountDetailViewModel;
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
  const { credential } = account;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-5">
      <div className="flex items-start gap-3">
        <ServiceIcon service={account.service} label={account.label} className="size-10" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold text-base">{account.label}</h2>
          <p className="text-muted-foreground text-xs">
            {account.serviceLabel ?? t('customService')} · {credentialTypeLabel(t, credential)}
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
          {credential.kind === 'oauth' ? (
            <OauthRows credential={credential} />
          ) : (
            <DetailRow label={credentialTypeLabel(t, credential)}>
              <span className="min-w-0 flex-1 truncate font-mono text-sm">
                {revealed ? credential.value : credential.maskedValue}
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
                  void copy(credential.value);
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
          {account.accountModel !== undefined && account.accountModel !== '' ? (
            <DetailRow label={t('accountModel')}>
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
                {account.accountModel}
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
            {t('connectionsEnabled', {
              bound: account.boundAgents.length,
              available: account.availableBindingCount,
            })}
          </span>
        </div>
        <div className="rounded-lg border border-border">
          {account.bindings.map((binding) => (
            <BindingRow
              key={binding.kind}
              accountId={account.id}
              binding={binding}
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
            {account.configPreview ?? t('configPreviewEmpty')}
          </pre>
        </CollapsiblePanel>
      </Collapsible>

      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeTitle', { label: account.label })}</AlertDialogTitle>
            <AlertDialogDescription>
              {account.boundAgents.length > 0
                ? t('removeInUse', {
                    agents: account.boundAgents.map((kind) => tAgent(kind)).join('、'),
                  })
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
  credential: ProviderCredentialViewModel,
): string {
  if (credential.kind === 'oauth') return t('credentialOauth');
  if (credential.type === 'api-key') return t('credentialApiKey');
  return t('credentialAuthToken');
}

/** Credential rows for a subscription account: the delegated CLI login and its probed state. */
function OauthRows({
  credential,
}: {
  credential: Extract<ProviderCredentialViewModel, { kind: 'oauth' }>;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const tAgent = useTranslations('workbench.agentKind');
  const { auth } = credential;
  return (
    <>
      <DetailRow label={t('credential')}>
        <span className="text-sm">{t('oauthDelegate', { agent: tAgent(credential.agent) })}</span>
      </DetailRow>
      {auth ? (
        <DetailRow label={t('loginState')}>
          <span className="text-sm">
            {auth.loggedIn ? [t('loggedIn'), ...auth.details].join(' · ') : t('loggedOut')}
          </span>
        </DetailRow>
      ) : null}
    </>
  );
}

function bindingStatusLabel(
  t: ReturnType<typeof useTranslations<'settings.providers'>>,
  tAgent: ReturnType<typeof useTranslations<'workbench.agentKind'>>,
  status: ProviderBindingStatus,
): string {
  switch (status.kind) {
    case 'unavailable-oauth':
      return t('unavailableOauth', { agent: tAgent(status.agent) });
    case 'unavailable-translation-endpoint':
      return t('unavailableTranslationEndpoint');
    case 'unavailable-protocol':
      return t('unavailableProtocol');
    case 'bound':
      return t('boundNote');
    case 'no-provider':
      return t('noProvider');
    case 'bound-elsewhere':
      return t('boundElsewhere', { label: status.accountLabel });
    default:
      return status satisfies never;
  }
}

function BindingRow({
  accountId,
  binding,
  busy,
  onSetBinding,
  onSetModel,
}: {
  accountId: string;
  binding: ProviderBindingViewModel;
  busy: boolean;
  onSetBinding: (kind: AgentKind, accountId: string | undefined) => void;
  onSetModel: (kind: AgentKind, model: string | undefined) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const tAgent = useTranslations('workbench.agentKind');

  const unavailable = binding.tier === 'unavailable';
  const status = bindingStatusLabel(t, tAgent, binding.status);
  const note = binding.tier === 'translate' ? `${t('translateNote')} · ${status}` : status;
  const modelOptions = AGENT_MODEL_OPTIONS[binding.kind];

  return (
    <div
      className={`flex items-center gap-3 border-border border-t px-3 py-2.5 first:border-t-0 ${unavailable ? 'opacity-50' : ''}`}
    >
      <AgentIcon kind={binding.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{tAgent(binding.kind)}</span>
          {binding.tier === 'translate' ? (
            <Badge variant="outline">{t('translateBadge')}</Badge>
          ) : null}
        </div>
        <p className="truncate text-muted-foreground text-xs">{note}</p>
      </div>
      {binding.bound && modelOptions ? (
        <ModelSelect
          options={
            modelOptions.some((option) => option.id === binding.currentModel) ||
            binding.currentModel === ''
              ? modelOptions
              : [...modelOptions, { id: binding.currentModel, label: binding.currentModel }]
          }
          value={binding.currentModel}
          disabled={busy}
          onChange={(model) => onSetModel(binding.kind, model === '' ? undefined : model)}
        />
      ) : null}
      <Switch
        checked={binding.bound}
        disabled={unavailable || busy}
        onCheckedChange={(checked) => onSetBinding(binding.kind, checked ? accountId : undefined)}
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
