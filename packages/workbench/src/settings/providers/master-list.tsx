import type {
  Account,
  Accounts,
  AgentLocalProvider,
  AgentRuntimes,
  ProvidersConfig,
} from '@linkcode/schema';
import { ServiceIcon } from '@linkcode/ui';
import { Button } from 'coss-ui/components/button';
import { Input } from 'coss-ui/components/input';
import { Skeleton } from 'coss-ui/components/skeleton';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { detectedLoginSuggestions, serviceById } from './catalog';
import { AGENT_KINDS, boundAgentKinds } from './view';

/** Left column of the Providers page: searchable account pool with bound-agent chips. */
export function AccountMasterList({
  accounts,
  loading,
  providers,
  runtimes,
  localProviders,
  selectedId,
  onSelect,
  onAdd,
  onAdoptDetected,
}: {
  accounts: Accounts;
  loading: boolean;
  providers: ProvidersConfig | undefined;
  runtimes: AgentRuntimes | undefined;
  /** Custom providers scanned from pi's own models.json — read-only cards below the pool: their
   * models are already usable, and the definition is edited in that file, never here. */
  localProviders: AgentLocalProvider[] | undefined;
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
  const subline = (account: Account): string => {
    const base = serviceById(account.service)?.label ?? t('customService');
    if (account.credential.type !== 'oauth') return base;
    const auth = runtimes?.[account.credential.agent]?.auth;
    if (auth === undefined) return base;
    if (!auth.loggedIn) return `${base} · ${t('loggedOut')}`;
    return auth.email ?? base;
  };

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
                      {subline(account)}
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
        {needle === ''
          ? detectedLoginSuggestions(accounts, runtimes).map(({ service, auth }) => (
              <li key={service.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-lg border border-border border-dashed p-2.5 text-left transition-colors hover:bg-muted/50"
                  onClick={() => onAdoptDetected(service.id)}
                >
                  <ServiceIcon service={service.id} label={service.label} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-sm">
                        {t(`serviceName.${service.id}`)}
                      </span>
                      <span className="rounded-full border border-border px-1.5 text-[10px] text-muted-foreground leading-4">
                        {t('detected')}
                      </span>
                    </span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {auth.email ?? t('loggedIn')}
                    </span>
                  </span>
                  <PlusIcon className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            ))
          : null}
        {needle === ''
          ? localProviders?.map((provider) => (
              <li
                key={provider.id}
                className="flex items-start gap-2.5 rounded-lg border border-border border-dashed p-2.5"
              >
                <ServiceIcon service={undefined} label={provider.id} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-sm">{provider.id}</span>
                    <span className="rounded-full border border-border px-1.5 text-[10px] text-muted-foreground leading-4">
                      {t('localProviders.source')}
                    </span>
                  </span>
                  {provider.baseUrl === undefined ? null : (
                    <span className="block truncate text-muted-foreground text-xs">
                      {provider.baseUrl}
                    </span>
                  )}
                  <span className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-full border border-border bg-background px-1.5 text-[10px] leading-4">
                      {t('localProviders.modelCount', { count: provider.models.length })}
                    </span>
                  </span>
                </span>
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
