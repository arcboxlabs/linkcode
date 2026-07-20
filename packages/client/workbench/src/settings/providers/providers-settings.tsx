import type { Account, AgentKind, ProvidersConfig } from '@linkcode/schema';
import {
  getAccounts,
  getAgentCatalog,
  getProviderConfig,
  setAccounts,
  setProviderConfig,
} from '@linkcode/sdk';
import { AccountDetail, AccountMasterList } from '@linkcode/ui';
import { Skeleton } from 'coss-ui/components/skeleton';
import { useTranslations } from 'use-intl';
import { useAgentRuntimes } from '../../agent-runtime/hooks';
import { useData, useMutation } from '../../runtime/tayori';
import { oauthAccount } from './account-form';
import { AddAccountForm, EditAccountForm, ServiceCatalogView } from './add-flow';
import { serviceById } from './catalog';
import { useProvidersSettingsStore } from './store';
import {
  providerAccountDetailViewModel,
  providerAccountListViewModel,
  withBinding,
  withModel,
  withoutAccount,
} from './view';

/**
 * The Providers settings page: the global account pool (master list) plus per-account credential
 * and agent bindings (detail); the add flow takes over the detail pane. Transport-backed — it
 * must render inside `WorkbenchProviders`, but may sit above the connection gate, degrading to
 * loading/error while the daemon is down.
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
  // Read-only local-provider cards under the pool (pi's models.json custom providers).
  const { data: piCatalog } = useData(getAgentCatalog, { agentKind: 'pi' });
  const saveAccounts = useMutation(setAccounts);
  const saveProviders = useMutation(setProviderConfig);

  const selectedId = useProvidersSettingsStore((state) => state.selectedAccountId);
  const view = useProvidersSettingsStore((state) => state.view);
  const select = useProvidersSettingsStore((state) => state.select);
  const startAdd = useProvidersSettingsStore((state) => state.startAdd);
  const pickService = useProvidersSettingsStore((state) => state.pickService);
  const backToCatalog = useProvidersSettingsStore((state) => state.backToCatalog);
  const startEdit = useProvidersSettingsStore((state) => state.startEdit);
  const closeAdd = useProvidersSettingsStore((state) => state.closeAdd);

  const pool = accounts ?? [];
  const selected = pool.find((account) => account.id === selectedId) ?? pool.at(0);
  const busy = saveAccounts.isMutating || saveProviders.isMutating;
  const selectedDetail =
    selected === undefined
      ? undefined
      : providerAccountDetailViewModel(selected, pool, providers, runtimes);
  const accountList = providerAccountListViewModel(pool, providers, runtimes);

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

  // One pool write for a whole models.json import — sequential handleAdd calls would race on `pool`.
  const handleAddMany = async (accounts: Account[]): Promise<void> => {
    if (accounts.length === 0) return;
    await saveAccounts.trigger({ accounts: [...pool, ...accounts] });
    void mutateAccounts();
    select(accounts[0].id);
  };

  // One-click adoption of a detected CLI login: same account the oauth form would create.
  const handleAdoptDetected = (serviceId: string): void => {
    const service = serviceById(serviceId);
    if (service?.kind !== 'oauth') return;
    void handleAdd(oauthAccount(service, t(`serviceName.${service.id}`)));
  };

  // In-place replacement keyed by id — bindings referencing the account stay valid.
  const handleUpdate = async (account: Account): Promise<void> => {
    await saveAccounts.trigger({
      accounts: pool.map((candidate) => (candidate.id === account.id ? account : candidate)),
    });
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
  // The edited account may have vanished under us (another client's write) — fall back to browse.
  const editing =
    effectiveView.kind === 'edit'
      ? pool.find((account) => account.id === effectiveView.accountId)
      : undefined;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-semibold text-sm">{t('title')}</h2>
        <p className="text-muted-foreground text-xs">{t('hint')}</p>
      </div>
      <div className="flex gap-6">
        <AccountMasterList
          {...accountList}
          loading={accountsLoading}
          localProviders={piCatalog?.localProviders}
          selectedId={selected?.id}
          onSelect={select}
          onAdd={startAdd}
          onAdoptDetected={handleAdoptDetected}
        />
        <div className="min-w-0 flex-1">
          {editing ? (
            <EditAccountForm
              account={editing}
              busy={saveAccounts.isMutating}
              onCancel={closeAdd}
              onSubmit={(account) => {
                void handleUpdate(account);
              }}
            />
          ) : effectiveView.kind === 'add-form' ? (
            <AddAccountForm
              serviceId={effectiveView.service}
              runtimes={runtimes}
              busy={saveAccounts.isMutating}
              onBack={backToCatalog}
              onSubmit={(account) => {
                void handleAdd(account);
              }}
              onSubmitMany={(accounts) => {
                void handleAddMany(accounts);
              }}
            />
          ) : effectiveView.kind === 'add-catalog' ? (
            <ServiceCatalogView
              onPick={pickService}
              onCancel={pool.length > 0 ? closeAdd : undefined}
            />
          ) : selectedDetail ? (
            <AccountDetail
              account={selectedDetail}
              busy={busy}
              onSetBinding={handleSetBinding}
              onSetModel={handleSetModel}
              onEdit={() => startEdit(selectedDetail.id)}
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
