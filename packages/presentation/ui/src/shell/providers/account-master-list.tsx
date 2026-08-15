import type { AgentKind } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Card } from 'coss-ui/components/card';
import { Input } from 'coss-ui/components/input';
import { Skeleton } from 'coss-ui/components/skeleton';
import { ChevronRightIcon, PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { ServiceIcon } from '../service-icon';
import type { ProviderAccountRouting } from './routing';

export interface ProviderAccountListItem {
  id: string;
  service?: string;
  label: string;
  serviceLabel?: string;
  routing?: ProviderAccountRouting;
  credentialType: 'api-key' | 'auth-token' | 'oauth';
  auth?: { loggedIn: boolean; email?: string };
  boundAgents: AgentKind[];
}

export interface ProviderAccountListViewModel {
  accounts: ProviderAccountListItem[];
}

/** The Providers page's single account list; account management opens outside the list. */
export function AccountList({
  accounts,
  loading,
  onSelect,
  onAdd,
  onUseLinkCodeGateway,
}: ProviderAccountListViewModel & {
  loading: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  /** Explicit first-party path shown only when no third-party account or login is available. */
  onUseLinkCodeGateway?: () => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const tAgent = useTranslations('workbench.agentKind');
  const [query, setQuery] = useState('');

  const credentialLabel = (account: ProviderAccountListItem): string => {
    if (account.credentialType === 'oauth') return t('credentialOauth');
    if (account.credentialType === 'api-key') return t('credentialApiKey');
    return t('credentialAuthToken');
  };

  /** Undefined means the row has no second line — the sole decision, so no separate render gate
   * can disagree with it. Catalog accounts deliberately show nothing: their wire shapes are an
   * implementation detail the add flow stopped asking about, and this slot has no label to give
   * bare protocol names any meaning (the detail pane shows them under `t('protocols')`). */
  const accountDetailLine = (account: ProviderAccountListItem): string | undefined => {
    if (account.auth?.loggedIn === true) return account.auth.email ?? t('loggedIn');
    if (account.auth) return t('loggedOut');
    return account.routing?.kind === 'pinned'
      ? `${account.routing.baseUrl} · ${account.routing.protocol}`
      : undefined;
  };

  const needle = query.trim().toLowerCase();
  const rows = needle
    ? accounts.filter((account) =>
        [
          account.label,
          account.serviceLabel ?? '',
          account.routing?.kind === 'pinned' ? account.routing.baseUrl : '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    : accounts;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex gap-2">
          <Input
            className="min-w-0 flex-1 sm:w-56"
            value={query}
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button type="button" size="sm" onClick={onAdd}>
            <PlusIcon className="size-4" />
            {t('addAccount')}
          </Button>
        </div>
      </div>
      <Card className="overflow-hidden">
        <ul className="divide-y divide-border">
          {loading && accounts.length === 0 ? (
            <>
              <li className="p-4">
                <Skeleton className="h-14 w-full rounded-lg" />
              </li>
              <li className="p-4">
                <Skeleton className="h-14 w-full rounded-lg" />
              </li>
            </>
          ) : null}
          {rows.map((account) => {
            const detailLine = accountDetailLine(account);
            return (
              <li key={account.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
                  onClick={() => onSelect(account.id)}
                >
                  <ServiceIcon
                    service={account.service}
                    label={account.label}
                    className="size-10"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-sm">{account.label}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {account.serviceLabel ?? t('customService')} · {credentialLabel(account)}
                    </span>
                    {detailLine ? (
                      <span className="block truncate text-muted-foreground text-xs">
                        {detailLine}
                      </span>
                    ) : null}
                  </span>
                  {/* Naming no agent is not a defect — the account's models still reach every
                      picker it is enabled for — so the row says nothing rather than "not connected". */}
                  <span className="hidden max-w-60 flex-wrap justify-end gap-1 sm:flex">
                    {account.boundAgents.map((kind) => (
                      <Badge key={kind} variant="outline" size="sm" className="rounded-full">
                        {tAgent(kind)}
                      </Badge>
                    ))}
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
          {!loading && needle && rows.length === 0 ? (
            <li className="px-4 py-12 text-center text-muted-foreground text-sm">
              {t('noMatches')}
            </li>
          ) : null}
          {!loading && needle === '' && accounts.length === 0 ? (
            <li className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <span className="font-medium text-sm">{t('emptyTitle')}</span>
              <span className="max-w-sm text-muted-foreground text-xs">{t('emptyHint')}</span>
              {onUseLinkCodeGateway ? (
                <Button type="button" size="sm" className="mt-2" onClick={onUseLinkCodeGateway}>
                  {t('linkCodeUseGateway')}
                </Button>
              ) : null}
            </li>
          ) : null}
        </ul>
      </Card>
    </div>
  );
}
