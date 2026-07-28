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

export interface ProviderAccountListItem {
  id: string;
  service?: string;
  label: string;
  serviceLabel?: string;
  endpoint?: string;
  protocol?: string;
  credentialType: 'api-key' | 'auth-token' | 'oauth';
  auth?: { loggedIn: boolean; email?: string };
  boundAgents: AgentKind[];
}

export interface DetectedProviderLoginItem {
  service: string;
  label: string;
  email?: string;
}

export interface ProviderAccountListViewModel {
  accounts: ProviderAccountListItem[];
  detectedLogins: DetectedProviderLoginItem[];
  bindingCount: number;
  agentCount: number;
}

/** The Providers page's single account list; account management opens outside the list. */
export function AccountList({
  accounts,
  detectedLogins,
  bindingCount,
  agentCount,
  loading,
  onSelect,
  onAdd,
  onAdoptDetected,
}: ProviderAccountListViewModel & {
  loading: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  /** One-click adopt a detected CLI login into the pool (a suggestion card, not a pool member). */
  onAdoptDetected: (serviceId: string) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const tAgent = useTranslations('workbench.agentKind');
  const [query, setQuery] = useState('');

  const credentialLabel = (account: ProviderAccountListItem): string => {
    if (account.credentialType === 'oauth') return t('credentialOauth');
    if (account.credentialType === 'api-key') return t('credentialApiKey');
    return t('credentialAuthToken');
  };

  const accountDetailLine = (account: ProviderAccountListItem): string => {
    if (account.auth?.loggedIn === true) return account.auth.email ?? t('loggedIn');
    if (account.auth) return t('loggedOut');
    return [account.endpoint, account.protocol].filter(Boolean).join(' · ');
  };

  const needle = query.trim().toLowerCase();
  const rows = needle
    ? accounts.filter((account) =>
        [account.label, account.serviceLabel ?? '', account.endpoint ?? '']
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    : accounts;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm">
            {t('accountCount', { count: accounts.length })}
          </span>
          <span className="text-muted-foreground text-xs">
            {t('boundCount', { bound: bindingCount, total: agentCount })}
          </span>
        </div>
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
          {rows.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
                onClick={() => onSelect(account.id)}
              >
                <ServiceIcon service={account.service} label={account.label} className="size-10" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-sm">{account.label}</span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {account.serviceLabel ?? t('customService')} · {credentialLabel(account)}
                  </span>
                  {account.auth !== undefined || account.endpoint !== undefined ? (
                    <span className="block truncate text-muted-foreground text-xs">
                      {accountDetailLine(account)}
                    </span>
                  ) : null}
                </span>
                <span className="hidden max-w-60 flex-wrap justify-end gap-1 sm:flex">
                  {account.boundAgents.length === 0 ? (
                    <Badge
                      variant="outline"
                      size="sm"
                      className="rounded-full border-dashed text-muted-foreground"
                    >
                      {t('unbound')}
                    </Badge>
                  ) : (
                    account.boundAgents.map((kind) => (
                      <Badge key={kind} variant="outline" size="sm" className="rounded-full">
                        {tAgent(kind)}
                      </Badge>
                    ))
                  )}
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
          {!loading && needle && rows.length === 0 ? (
            <li className="px-4 py-12 text-center text-muted-foreground text-sm">
              {t('noMatches')}
            </li>
          ) : null}
          {!loading && needle === '' && accounts.length === 0 && detectedLogins.length === 0 ? (
            <li className="flex flex-col items-center gap-1 px-6 py-12 text-center">
              <span className="font-medium text-sm">{t('emptyTitle')}</span>
              <span className="max-w-sm text-muted-foreground text-xs">{t('emptyHint')}</span>
            </li>
          ) : null}
          {!loading && needle === ''
            ? detectedLogins.map((login) => (
                <li key={login.service}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
                    onClick={() => onAdoptDetected(login.service)}
                  >
                    <ServiceIcon
                      service={login.service}
                      label={login.label}
                      className="size-10 border-dashed"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-sm">
                          {t(`serviceName.${login.service}`)}
                        </span>
                        <Badge
                          variant="outline"
                          size="sm"
                          className="rounded-full text-muted-foreground"
                        >
                          {t('detected')}
                        </Badge>
                      </span>
                      <span className="block truncate text-muted-foreground text-xs">
                        {login.email ?? t('loggedIn')}
                      </span>
                    </span>
                    <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))
            : null}
        </ul>
      </Card>
    </div>
  );
}
