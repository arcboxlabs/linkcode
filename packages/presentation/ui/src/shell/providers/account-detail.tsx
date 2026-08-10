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
import { ServiceIcon } from '../service-icon';
import type { ProviderAccountRouting } from './routing';

export type ProviderAgentStatus =
  | { kind: 'unavailable-oauth'; agent: AgentKind }
  | { kind: 'unavailable-endpoint-incomplete' }
  | { kind: 'unavailable-protocol' }
  | { kind: 'disabled' };

/** One agent row in an account's dialog: whether this account's models are offered to that agent.
 * That is the whole state — nothing here is a default, and the switch says it without help. */
export interface ProviderAgentViewModel {
  kind: AgentKind;
  tier: 'native' | 'translate' | 'unavailable';
  /** Only a reason the row cannot be, or is not, on. Absent means enabled and available. */
  status?: ProviderAgentStatus;
  enabled: boolean;
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
  routing?: ProviderAccountRouting;
  /** Models the user picked for this account — the only ones its pickers offer. */
  accountModels?: Array<{ id: string; label: string }>;
  agents: ProviderAgentViewModel[];
  /** Agents that fall back to this account; named in the removal warning. */
  boundAgents: AgentKind[];
  enabledAgentCount: number;
  availableAgentCount: number;
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

/** Account-dialog content: credential, per-agent binding switches, and config preview. */
export function AccountDetail({
  account,
  busy,
  onSetAccountEnabled,
  onEdit,
  onRemove,
}: {
  account: ProviderAccountDetailViewModel;
  /** A providers/accounts write is in flight — hold the switches. */
  busy: boolean;
  /** Show or hide this account's models in that agent's pickers. */
  onSetAccountEnabled: (kind: AgentKind, enabled: boolean) => void;
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
          {account.routing?.kind === 'pinned' ? (
            <DetailRow label={t('endpoint')}>
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
                {account.routing.baseUrl} · {account.routing.protocol}
              </span>
            </DetailRow>
          ) : account.routing?.kind === 'catalog' ? (
            <DetailRow label={t('protocols')}>
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
                {account.routing.protocols.join(' · ')}
              </span>
            </DetailRow>
          ) : null}
          {account.accountModels !== undefined && account.accountModels.length > 0 ? (
            <DetailRow label={t('accountModel')}>
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
                {account.accountModels.map(({ id }) => id).join(' · ')}
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
              bound: account.enabledAgentCount,
              available: account.availableAgentCount,
            })}
          </span>
        </div>
        <div className="rounded-lg border border-border">
          {account.agents.map((agent) => (
            <AgentRow
              key={agent.kind}
              agent={agent}
              busy={busy}
              onSetAccountEnabled={onSetAccountEnabled}
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

function agentStatusLabel(
  t: ReturnType<typeof useTranslations<'settings.providers'>>,
  tAgent: ReturnType<typeof useTranslations<'workbench.agentKind'>>,
  status: ProviderAgentStatus,
): string {
  switch (status.kind) {
    case 'unavailable-oauth':
      return t('unavailableOauth', { agent: tAgent(status.agent) });
    case 'unavailable-endpoint-incomplete':
      return t('unavailableEndpointIncomplete');
    case 'unavailable-protocol':
      return t('unavailableProtocol');
    case 'disabled':
      return t('accountDisabled');
    default:
      return status satisfies never;
  }
}

/** One agent's row: whether this account's models appear in that agent's pickers. */
function AgentRow({
  agent,
  busy,
  onSetAccountEnabled,
}: {
  agent: ProviderAgentViewModel;
  busy: boolean;
  onSetAccountEnabled: (kind: AgentKind, enabled: boolean) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const tAgent = useTranslations('workbench.agentKind');

  const unavailable = agent.tier === 'unavailable';
  const status = agent.status && agentStatusLabel(t, tAgent, agent.status);
  const note =
    agent.tier === 'translate' ? [t('translateNote'), status].filter(Boolean).join(' · ') : status;

  return (
    <div
      className={`flex items-center gap-3 border-border border-t px-3 py-2.5 first:border-t-0 ${unavailable ? 'opacity-50' : ''}`}
    >
      <AgentIcon kind={agent.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{tAgent(agent.kind)}</span>
          {agent.tier === 'translate' ? (
            <Badge variant="outline">{t('translateBadge')}</Badge>
          ) : null}
        </div>
        {note ? <p className="truncate text-muted-foreground text-xs">{note}</p> : null}
      </div>
      <Switch
        checked={agent.enabled}
        disabled={unavailable || busy}
        onCheckedChange={(checked) => onSetAccountEnabled(agent.kind, checked)}
      />
    </div>
  );
}
