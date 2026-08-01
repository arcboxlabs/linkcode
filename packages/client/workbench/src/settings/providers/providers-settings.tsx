import type { Account, AgentKind, ProvidersConfig } from '@linkcode/schema';
import { getAccounts, getProviderConfig, setAccounts, setProviderConfig } from '@linkcode/sdk';
import { AccountDetail, AccountList, AGENT_LABELS, AgentOnboardingCard } from '@linkcode/ui';
import { Button } from 'coss-ui/components/button';
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from 'coss-ui/components/dialog';
import { Skeleton } from 'coss-ui/components/skeleton';
import { ChevronLeftIcon, KeyRoundIcon, LogInIcon } from 'lucide-react';
import { useTranslations } from 'use-intl';
import { AgentApiKeyLoginDialog } from '../../agent-runtime/api-key-login/dialog';
import { useAgentApiKeyLoginStore } from '../../agent-runtime/api-key-login/store';
import { useAgentRuntimes } from '../../agent-runtime/hooks';
import { useAgentRuntimeOnboarding } from '../../agent-runtime/onboarding';
import { useData, useMutation } from '../../runtime/tayori';
import { AddAccountForm, EditAccountForm, oauthAccount, ServiceCatalogView } from './add-flow';
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
 * The Providers settings page: one account list, with account management and creation in a dialog.
 * Transport-backed — it must render inside `WorkbenchProviders`, but may sit above the connection
 * gate, degrading to loading/error while the daemon is down.
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
  const onboarding = useAgentRuntimeOnboarding();
  const saveAccounts = useMutation(setAccounts);
  const saveProviders = useMutation(setProviderConfig);

  const view = useProvidersSettingsStore((state) => state.view);
  const select = useProvidersSettingsStore((state) => state.select);
  const startEdit = useProvidersSettingsStore((state) => state.startEdit);
  const backToAccount = useProvidersSettingsStore((state) => state.backToAccount);
  const startAdd = useProvidersSettingsStore((state) => state.startAdd);
  const startAgentSetup = useProvidersSettingsStore((state) => state.startAgentSetup);
  const startAgentLogin = useProvidersSettingsStore((state) => state.startAgentLogin);
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
    await mutateAccounts();
    closeDialog();
  };

  const handleUpdate = async (account: Account): Promise<void> => {
    await saveAccounts.trigger({
      accounts: pool.map((candidate) => (candidate.id === account.id ? account : candidate)),
    });
    await mutateAccounts();
    select(account.id);
  };

  // One-click adoption of a detected CLI login: same account the oauth form would create.
  const handleAdoptDetected = (serviceId: string): void => {
    const service = serviceById(serviceId);
    if (service?.kind !== 'oauth') return;
    void handleAdd(oauthAccount(service, t(`serviceName.${service.id}`)));
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

  const handleSubscriptionLogin = (kind: AgentKind): void => {
    startAgentLogin(kind);
    onboarding.login(kind, closeDialog);
  };

  const handleCancelLogin = (kind: AgentKind): void => {
    onboarding.cancelLogin(kind);
    startAgentSetup(kind);
  };

  const handleApiKeySetup = (kind: AgentKind): void => {
    closeDialog();
    useAgentApiKeyLoginStore.getState().open(kind);
  };

  const dialogOpen = view.kind !== 'browse';

  return (
    <div className="flex flex-col gap-5">
      {/* The page title is rendered by the settings shell; this is the lead subtitle. */}
      <p className="text-muted-foreground text-sm">{t('hint')}</p>
      <AccountList
        {...accountList}
        loading={accountsLoading}
        onSelect={select}
        onAdd={startAdd}
        onAdoptDetected={handleAdoptDetected}
      />
      <Dialog
        open={dialogOpen}
        disablePointerDismissal={saveAccounts.isMutating}
        onOpenChange={(open) => {
          if (!open && !saveAccounts.isMutating) {
            if (view.kind === 'agent-login') onboarding.cancelLogin(view.agent);
            closeDialog();
          }
        }}
      >
        <DialogPopup
          className={view.kind === 'add-catalog' ? 'max-w-3xl' : 'max-w-2xl'}
          closeProps={{ disabled: saveAccounts.isMutating }}
        >
          {view.kind === 'agent-setup' ? (
            <AgentProviderSetupChoices
              kind={view.agent}
              onLogin={handleSubscriptionLogin}
              onApiKey={handleApiKeySetup}
            />
          ) : view.kind === 'agent-login' ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t('setup.subscriptionTitle', { agent: AGENT_LABELS[view.agent] })}
                </DialogTitle>
              </DialogHeader>
              <DialogPanel className="flex flex-col gap-3">
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => handleCancelLogin(view.agent)}
                  >
                    <ChevronLeftIcon className="size-4" />
                    {t('setup.chooseMethod')}
                  </Button>
                </div>
                <AgentOnboardingCard
                  kind={view.agent}
                  cue={
                    onboarding.cues[view.agent] ?? { state: 'needs-login', phase: 'idle' as const }
                  }
                  onLogin={handleSubscriptionLogin}
                  onSubmitLoginCode={onboarding.submitLoginCode}
                  onCancelLogin={handleCancelLogin}
                />
              </DialogPanel>
            </>
          ) : view.kind === 'add-catalog' ? (
            <>
              <DialogHeader>
                <DialogTitle>{t('chooseService')}</DialogTitle>
              </DialogHeader>
              <DialogPanel>
                <ServiceCatalogView onPick={pickService} />
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
                    runtimes={runtimes}
                    busy={saveAccounts.isMutating}
                    onBack={backToCatalog}
                    onSubmit={(account) => {
                      void handleAdd(account);
                    }}
                  />
                ) : selectedDetail && selected && view.kind === 'account' ? (
                  view.editing ? (
                    <EditAccountForm
                      account={selected}
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
                      onSetBinding={handleSetBinding}
                      onSetModel={handleSetModel}
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
      <AgentApiKeyLoginDialog />
    </div>
  );
}

function AgentProviderSetupChoices({
  kind,
  onLogin,
  onApiKey,
}: {
  kind: AgentKind;
  onLogin: (kind: AgentKind) => void;
  onApiKey: (kind: AgentKind) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const agent = AGENT_LABELS[kind];
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('setup.title', { agent })}</DialogTitle>
        <DialogDescription>{t('setup.hint')}</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            className="flex min-h-28 flex-col items-start gap-2 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/50"
            onClick={() => onLogin(kind)}
          >
            <LogInIcon className="size-5" />
            <span>
              <span className="block font-medium text-sm">{t('setup.subscription')}</span>
              <span className="mt-1 block text-muted-foreground text-xs">
                {t('setup.subscriptionHint', { agent })}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="flex min-h-28 flex-col items-start gap-2 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/50"
            onClick={() => onApiKey(kind)}
          >
            <KeyRoundIcon className="size-5" />
            <span>
              <span className="block font-medium text-sm">{t('setup.apiKey')}</span>
              <span className="mt-1 block text-muted-foreground text-xs">
                {t('setup.apiKeyHint')}
              </span>
            </span>
          </button>
        </div>
      </DialogPanel>
    </>
  );
}
