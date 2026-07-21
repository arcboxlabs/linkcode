import type { AgentKind } from '@linkcode/schema';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Input } from 'coss-ui/components/input';
import { Skeleton } from 'coss-ui/components/skeleton';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { ServiceIcon } from '../service-icon';

export interface ProviderAccountListItem {
  id: string;
  service?: string;
  label: string;
  serviceLabel?: string;
  endpoint?: string;
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

/** Left column of the Providers page: searchable account pool with bound-agent chips. */
export function AccountMasterList({
  accounts,
  detectedLogins,
  bindingCount,
  agentCount,
  loading,
  selectedId,
  onSelect,
  onAdd,
  onAdoptDetected,
}: ProviderAccountListViewModel & {
  loading: boolean;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onAdd: () => void;
  /** One-click adopt a detected CLI login into the pool (a suggestion card, not a pool member). */
  onAdoptDetected: (serviceId: string) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const tAgent = useTranslations('workbench.agentKind');
  const [query, setQuery] = useState('');

  // An oauth card's subline is the CLI's live identity when the probe knows it.
  const subline = (account: ProviderAccountListItem): string => {
    const base = account.serviceLabel ?? t('customService');
    const { auth } = account;
    if (auth === undefined) return base;
    if (!auth.loggedIn) return `${base} · ${t('loggedOut')}`;
    return auth.email ?? base;
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
    <div className="flex w-60 shrink-0 flex-col gap-3">
      <Input
        value={query}
        placeholder={t('searchPlaceholder')}
        autoComplete="off"
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex items-baseline justify-between px-1">
        <span className="font-semibold text-sm">
          {t('accountCount', { count: accounts.length })}
        </span>
        <span className="text-muted-foreground text-xs">
          {t('boundCount', { bound: bindingCount, total: agentCount })}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {loading && accounts.length === 0 ? (
          <>
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </>
        ) : (
          rows.map((account) => (
            <li key={account.id}>
              <button
                type="button"
                className={`flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                  account.id === selectedId
                    ? 'border-border bg-muted'
                    : 'border-transparent hover:bg-muted/50'
                }`}
                onClick={() => onSelect(account.id)}
              >
                <ServiceIcon service={account.service} label={account.label} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-sm">{account.label}</span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {subline(account)}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
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
                </span>
              </button>
            </li>
          ))
        )}
        {!loading && needle && rows.length === 0 ? (
          <li className="px-1 py-3 text-muted-foreground text-sm">{t('noMatches')}</li>
        ) : null}
        {needle === ''
          ? detectedLogins.map((login) => (
              <li key={login.service}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-lg border border-border border-dashed p-2.5 text-left transition-colors hover:bg-muted/50"
                  onClick={() => onAdoptDetected(login.service)}
                >
                  <ServiceIcon service={login.service} label={login.label} />
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
      <Button type="button" size="sm" variant="outline" onClick={onAdd}>
        {t('addAccount')}
      </Button>
    </div>
  );
}
