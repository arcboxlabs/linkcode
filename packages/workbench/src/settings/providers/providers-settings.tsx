import type { Account, AgentKind, ProvidersConfig } from '@linkcode/schema';
import { getAccounts, getProviderConfig, setAccounts, setProviderConfig } from '@linkcode/sdk';
import { Skeleton } from 'coss-ui/components/skeleton';
import { useTranslations } from 'use-intl';
import { useAgentRuntimes } from '../../agent-runtime/hooks';
import { useData, useMutation } from '../../runtime/tayori';
import { AccountDetail } from './account-detail';
import { AddAccountForm, ServiceCatalogView } from './add-flow';
import { AccountMasterList } from './master-list';
import { useProvidersSettingsStore } from './store';
import { withBinding, withModel, withoutAccount } from './view';

/**
 * The Providers settings page: the global account pool (master list) and, per selected account, its
 * credential and agent bindings (detail). A transport-backed container — it reads/writes accounts
 * and per-agent config over the data plane, so it must render inside `WorkbenchProviders`, but it
 * may sit above the connection gate (both apps mount it in their Settings surface), where it
 * degrades to loading/error while the daemon is down. The add flow takes over the detail pane
 * (design: v2 master/detail with the v1 two-step add flow).
 */
export function ProvidersSettingsPanel(): React.ReactNode {
  const t = useTranslations('settings.providers');
  const {
    data: accounts,
    isLoading: accountsLoading,
    mutate: mutateAccounts,
  } = useData(getAccounts, {});
  const { data: providers, mutate: mutateProviders } = useData(getProviderConfig, {});
  const { data: runtimes } = useAgentRuntimes();
  const saveAccounts = useMutation(setAccounts);
  const saveProviders = useMutation(setProviderConfig);

  const selectedId = useProvidersSettingsStore((state) => state.selectedAccountId);
  const view = useProvidersSettingsStore((state) => state.view);
  const select = useProvidersSettingsStore((state) => state.select);
  const startAdd = useProvidersSettingsStore((state) => state.startAdd);
  const pickService = useProvidersSettingsStore((state) => state.pickService);
  const backToCatalog = useProvidersSettingsStore((state) => state.backToCatalog);
  const closeAdd = useProvidersSettingsStore((state) => state.closeAdd);

  const pool = accounts ?? [];
  const selected = pool.find((account) => account.id === selectedId) ?? pool[0];
  const busy = saveAccounts.isMutating || saveProviders.isMutating;

  const applyProviders = async (next: ProvidersConfig): Promise<void> => {
    await saveProviders.trigger({ providers: next });
    void mutateProviders();
  };

  const handleSetBinding = (kind: AgentKind, accountId: string | undefined): void => {
    void applyProviders(withBinding(providers ?? {}, kind, accountId));
  };

  const handleSetModel = (kind: AgentKind, model: string | undefined): void => {
    void applyProviders(withModel(providers ?? {}, kind, model));
  };

  const handleAdd = async (account: Account): Promise<void> => {
    await saveAccounts.trigger({ accounts: [...pool, account] });
    void mutateAccounts();
    select(account.id);
  };

  const handleRemove = async (): Promise<void> => {
    if (!selected) return;
    const cleared = withoutAccount(providers ?? {}, selected.id);
    if (cleared !== providers) await applyProviders(cleared);
    await saveAccounts.trigger({
      accounts: pool.filter((account) => account.id !== selected.id),
    });
    void mutateAccounts();
    const fallback = pool.find((account) => account.id !== selected.id);
    if (fallback) select(fallback.id);
  };

  // An empty pool has nothing to browse — the detail pane is the service catalog itself.
  const effectiveView =
    view.kind === 'browse' && pool.length === 0 && !accountsLoading
      ? ({ kind: 'add-catalog' } as const)
      : view;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-semibold text-sm">{t('title')}</h2>
        <p className="text-muted-foreground text-xs">{t('hint')}</p>
      </div>
      <div className="flex gap-6">
        <AccountMasterList
          accounts={pool}
          loading={accountsLoading}
          providers={providers}
          selectedId={selected?.id}
          onSelect={select}
          onAdd={startAdd}
        />
        <div className="min-w-0 flex-1">
          {effectiveView.kind === 'add-form' ? (
            <AddAccountForm
              serviceId={effectiveView.service}
              runtimes={runtimes}
              busy={saveAccounts.isMutating}
              onBack={backToCatalog}
              onSubmit={(account) => {
                void handleAdd(account);
              }}
            />
          ) : effectiveView.kind === 'add-catalog' ? (
            <ServiceCatalogView
              onPick={pickService}
              onCancel={pool.length > 0 ? closeAdd : undefined}
            />
          ) : selected ? (
            <AccountDetail
              account={selected}
              accounts={pool}
              providers={providers}
              runtimes={runtimes}
              busy={busy}
              onSetBinding={handleSetBinding}
              onSetModel={handleSetModel}
              onRemove={() => {
                void handleRemove();
              }}
            />
          ) : (
            <Skeleton className="h-40 w-full rounded-lg" />
          )}
        </div>
      </div>
    </div>
  );
}
