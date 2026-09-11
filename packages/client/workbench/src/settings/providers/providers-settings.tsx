import { LINKCODE_GATEWAY_SERVICE_ID, serviceById } from '@linkcode/providers';
import type { Account, AgentKind, ProvidersConfig } from '@linkcode/schema';
import { getAccounts, getProviderConfig, setAccounts, setProviderConfig } from '@linkcode/sdk';
import { AccountDetail, AccountList } from '@linkcode/ui';
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from 'coss-ui/components/dialog';
import { Skeleton } from 'coss-ui/components/skeleton';
import { toastManager } from 'coss-ui/components/toast';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useTranslations } from 'use-intl';
import { useAgentRuntimes } from '../../agent-runtime/hooks';
import { useAgentRuntimeOnboarding } from '../../agent-runtime/onboarding';
import { useData, useMutation } from '../../runtime/tayori';
import type { LinkCodeGatewayAccess } from './add-flow';
import { AddAccountForm, EditAccountForm, ServiceCatalogView } from './add-flow';
import { useModelSources } from './model-selection';
import { useProvidersSettingsStore } from './store';
import {
  providerAccountDetailViewModel,
  providerAccountListViewModel,
  withAccountEnabled,
  withoutAccount,
} from './view';

/**
 * The Providers settings page: one account list, with account management and creation in a dialog.
 * Transport-backed — it must render inside `WorkbenchProviders`, but may sit above the connection
 * gate, degrading to loading/error while the daemon is down.
 */
export function ProvidersSettingsPanel({
  linkCodeGateway,
  allowedAgents = null,
  allowedServices = null,
}: {
  linkCodeGateway?: LinkCodeGatewayAccess;
  /** Restricted-brand allowlists (CODE-618); `null` (the default) means unrestricted. */
  allowedAgents?: readonly AgentKind[] | null;
  allowedServices?: readonly string[] | null;
} = {}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const {
    data: accounts,
    isLoading: accountsLoading,
    mutate: mutateAccounts,
  } = useData(getAccounts, {});
  const { data: providers, mutate: mutateProviders } = useData(getProviderConfig, {});
  const { data: runtimes } = useAgentRuntimes();
  const onboarding = useAgentRuntimeOnboarding();
  const saveAccounts = useMutation(setAccounts);
  const saveProviders = useMutation(setProviderConfig);
  // The forms are presentation; only this page sits inside the data-plane provider tree.
  const modelSources = useModelSources();

  const view = useProvidersSettingsStore((state) => state.view);
  const select = useProvidersSettingsStore((state) => state.select);
  const startEdit = useProvidersSettingsStore((state) => state.startEdit);
  const backToAccount = useProvidersSettingsStore((state) => state.backToAccount);
  const startAdd = useProvidersSettingsStore((state) => state.startAdd);
  const pickService = useProvidersSettingsStore((state) => state.pickService);
  const backToCatalog = useProvidersSettingsStore((state) => state.backToCatalog);
  const closeDialog = useProvidersSettingsStore((state) => state.closeDialog);

  const pool = accounts ?? [];
  const accountsById = new Map(pool.map((account) => [account.id, account]));
  const selected = view.kind === 'account' ? accountsById.get(view.accountId) : undefined;
  const busy = saveAccounts.isMutating || saveProviders.isMutating;
  const selectedDetail =
    selected === undefined
      ? undefined
      : providerAccountDetailViewModel(selected, providers, runtimes);
  const accountList = providerAccountListViewModel(pool, providers, runtimes);

  const applyProviders = async (next: ProvidersConfig): Promise<void> => {
    await saveProviders.trigger({ providers: next });
    void mutateProviders();
  };

  const handleSetAccountEnabled = (kind: AgentKind, enabled: boolean): void => {
    if (!selected) return;
    void applyProviders(withAccountEnabled(providers ?? {}, kind, selected.id, enabled, pool));
  };

  const handleReorder = async (orderedIds: string[]): Promise<void> => {
    const reordered = orderedIds.flatMap((id) => {
      const account = accountsById.get(id);
      return account ? [account] : [];
    });
    if (reordered.length !== pool.length) return;

    await mutateAccounts(reordered, { revalidate: false });
    try {
      await saveAccounts.trigger({ accounts: reordered });
    } catch (error) {
      await mutateAccounts(pool, { revalidate: false });
      toastManager.add({
        type: 'error',
        title: t('reorderFailed'),
        description: extractErrorMessage(error, false),
      });
      return;
    }
    await mutateAccounts();
  };

  // Every account joins the pool the same way. A subscription used to bind itself to its agent on
  // the way in; with no default to claim, adding one is adding one.
  const handleAdd = async (account: Account): Promise<void> => {
    await saveAccounts.trigger({ accounts: [...pool, account] });
    await mutateAccounts();
    if (account.service === LINKCODE_GATEWAY_SERVICE_ID) {
      select(account.id);
      startEdit();
    } else closeDialog();
  };

  const handleUpdate = async (account: Account): Promise<void> => {
    await saveAccounts.trigger({
      accounts: pool.map((candidate) => (candidate.id === account.id ? account : candidate)),
    });
    await mutateAccounts();
    select(account.id);
  };

  const handleRemove = async (): Promise<void> => {
    if (!selected) return;
    const cleared = withoutAccount(providers ?? {}, selected.id);
    if (cleared !== providers) await applyProviders(cleared);
    await saveAccounts.trigger({
      accounts: pool.filter((account) => account.id !== selected.id),
    });
    await mutateAccounts();
    closeDialog();
  };

  const dialogOpen = view.kind !== 'browse';

  const cancelSubscriptionLogin = (): void => {
    if (view.kind !== 'add-form') return;
    const service = serviceById(view.service);
    if (service?.kind === 'oauth') onboarding.cancelLogin(service.agent);
  };

  return (
    <div className="flex flex-col gap-5">
      {/* The page title is rendered by the settings shell; this is the lead subtitle. */}
      <p className="text-muted-foreground text-sm">{t('hint')}</p>
      <AccountList
        {...accountList}
        loading={accountsLoading}
        reorderDisabled={busy}
        onSelect={select}
        onReorder={(orderedIds) => {
          void handleReorder(orderedIds);
        }}
        onAdd={startAdd}
        onUseLinkCodeGateway={
          linkCodeGateway ? () => pickService(LINKCODE_GATEWAY_SERVICE_ID) : undefined
        }
      />
      <Dialog
        open={dialogOpen}
        disablePointerDismissal={busy}
        onOpenChange={(open) => {
          if (!open && !busy) {
            cancelSubscriptionLogin();
            closeDialog();
          }
        }}
      >
        <DialogPopup
          className={view.kind === 'add-catalog' ? 'max-w-3xl' : 'max-w-2xl'}
          closeProps={{ disabled: busy }}
        >
          {view.kind === 'add-catalog' ? (
            <>
              <DialogHeader>
                <DialogTitle>{t('chooseService')}</DialogTitle>
              </DialogHeader>
              <DialogPanel>
                <ServiceCatalogView
                  onPick={pickService}
                  linkCodeGatewayAvailable={linkCodeGateway !== undefined}
                  allowedAgents={allowedAgents}
                  allowedServices={allowedServices}
                />
              </DialogPanel>
            </>
          ) : (
            <>
              <DialogTitle className="sr-only">
                {view.kind === 'account' ? (selected?.label ?? t('edit')) : t('addAccount')}
              </DialogTitle>
              <DialogPanel>
                {view.kind === 'add-form' ? (
                  <AddAccountForm
                    serviceId={view.service}
                    sources={modelSources}
                    runtimes={runtimes}
                    onboarding={onboarding}
                    busy={busy}
                    linkCodeGateway={linkCodeGateway}
                    onBack={() => {
                      cancelSubscriptionLogin();
                      backToCatalog();
                    }}
                    onSubmit={(account) => {
                      void handleAdd(account);
                    }}
                  />
                ) : selectedDetail && selected && view.kind === 'account' ? (
                  view.editing ? (
                    <EditAccountForm
                      account={selected}
                      sources={modelSources}
                      busy={saveAccounts.isMutating}
                      onBack={backToAccount}
                      onSubmit={(account) => {
                        void handleUpdate(account);
                      }}
                    />
                  ) : (
                    <AccountDetail
                      account={selectedDetail}
                      busy={busy}
                      onSetAccountEnabled={handleSetAccountEnabled}
                      onEdit={startEdit}
                      onRemove={() => {
                        void handleRemove();
                      }}
                    />
                  )
                ) : accounts === undefined ? (
                  <Skeleton className="h-40 w-full rounded-lg" />
                ) : (
                  <div className="flex h-40 flex-col items-center justify-center gap-1 text-center">
                    <span className="font-medium text-sm">{t('accountMissingTitle')}</span>
                    <span className="text-muted-foreground text-xs">{t('accountMissingHint')}</span>
                  </div>
                )}
              </DialogPanel>
            </>
          )}
        </DialogPopup>
      </Dialog>
    </div>
  );
}
