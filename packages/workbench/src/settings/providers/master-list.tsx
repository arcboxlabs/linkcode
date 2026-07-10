import type { Accounts, ProvidersConfig } from '@linkcode/schema';
import { ServiceIcon } from '@linkcode/ui';
import { Button } from 'coss-ui/components/button';
import { Input } from 'coss-ui/components/input';
import { Skeleton } from 'coss-ui/components/skeleton';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { serviceById } from './catalog';
import { AGENT_KINDS, boundAgentKinds } from './view';

/** Left column of the Providers page: searchable account pool with bound-agent chips. */
export function AccountMasterList({
  accounts,
  loading,
  providers,
  selectedId,
  onSelect,
  onAdd,
}: {
  accounts: Accounts;
  loading: boolean;
  providers: ProvidersConfig | undefined;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onAdd: () => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const tAgent = useTranslations('workbench.agentKind');
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const rows = needle
    ? accounts.filter((account) =>
        [account.label, serviceById(account.service)?.label ?? '', account.endpoint?.baseUrl ?? '']
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    : accounts;
  const boundCount = AGENT_KINDS.filter(
    (kind) => providers?.[kind]?.activeAccountId !== undefined,
  ).length;

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
          {t('boundCount', { bound: boundCount, total: AGENT_KINDS.length })}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {loading && accounts.length === 0 ? (
          <>
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </>
        ) : (
          rows.map((account) => {
            const bound = boundAgentKinds(providers, account.id);
            return (
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
                      {serviceById(account.service)?.label ?? t('customService')}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {bound.length === 0 ? (
                        <span className="rounded-full border border-border border-dashed px-1.5 text-[10px] text-muted-foreground leading-4">
                          {t('unbound')}
                        </span>
                      ) : (
                        bound.map((kind) => (
                          <span
                            key={kind}
                            className="rounded-full border border-border bg-background px-1.5 text-[10px] leading-4"
                          >
                            {tAgent(kind)}
                          </span>
                        ))
                      )}
                    </span>
                  </span>
                </button>
              </li>
            );
          })
        )}
        {!loading && needle && rows.length === 0 ? (
          <li className="px-1 py-3 text-muted-foreground text-sm">{t('noMatches')}</li>
        ) : null}
      </ul>
      <Button type="button" size="sm" variant="outline" onClick={onAdd}>
        {t('addAccount')}
      </Button>
    </div>
  );
}
