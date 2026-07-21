import type { AgentKind, AgentRuntimeAvailability } from '@linkcode/schema';
import { getAccounts, getProviderConfig, setProviderConfig } from '@linkcode/sdk';
import { AgentIcon, AgentOnboardingCard, SettingsCard } from '@linkcode/ui';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Switch } from 'coss-ui/components/switch';
import { useTranslations } from 'use-intl';
import { useAgentRuntimes } from '../agent-runtime/hooks';
import { useAgentRuntimeOnboarding } from '../agent-runtime/onboarding';
import { useData, useMutation } from '../runtime/tayori';
import { bindingAvailability } from './providers/capability';
import { AGENT_KINDS, withEnabled } from './providers/view';

/**
 * The collapsed Agents tab: per-agent runtime concerns only — account bindings and models are
 * edited solely on the Providers page. Instant save; no form. An enabled agent whose runtime
 * isn't ready gets the onboarding card under its row (CODE-249), driven by the same cue state
 * machine as the new-session surface.
 */
export function AgentsSettingsPanel({
  onOpenProviders,
}: {
  /** Navigate to the Providers page, selecting the agent's bound account when there is one. */
  onOpenProviders: (accountId: string | undefined) => void;
}): React.ReactNode {
  const t = useTranslations('settings.agents');
  const tAgent = useTranslations('workbench.agentKind');
  const { data: providers, mutate: mutateProviders } = useData(getProviderConfig, {});
  const { data: accounts } = useData(getAccounts, {});
  const { data: runtimes } = useAgentRuntimes();
  const onboarding = useAgentRuntimeOnboarding();
  const saveProviders = useMutation(setProviderConfig);

  const applyEnabled = async (kind: AgentKind, enabled: boolean): Promise<void> => {
    await saveProviders.trigger({ providers: withEnabled(providers ?? {}, kind, enabled) });
    void mutateProviders();
  };

  return (
    <div className="flex flex-col gap-5">
      {/* The page title is rendered by the settings shell; this is the lead subtitle. */}
      <p className="text-muted-foreground text-sm">{t('hint')}</p>
      <SettingsCard>
        {AGENT_KINDS.map((kind) => {
          const runtime = runtimes?.[kind];
          const boundId = providers?.[kind]?.activeAccountId;
          const boundAccount = accounts?.find((account) => account.id === boundId);
          const enabled = providers?.[kind]?.enabled ?? true;
          // A disabled agent's runtime gaps don't matter — no card, just the badge.
          const cue = enabled ? onboarding.cues[kind] : undefined;
          const translated =
            boundAccount !== undefined &&
            bindingAvailability(boundAccount, kind).tier === 'translate';
          // With no bound account the agent follows the CLI login — show who that is when probed.
          const cliIdentity =
            boundAccount === undefined && runtime?.auth?.loggedIn === true
              ? runtime.auth.email
              : undefined;
          return (
            <div key={kind} className="px-3 py-3">
              <div className="flex items-center gap-3">
                <AgentIcon kind={kind} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{tAgent(kind)}</span>
                    <RuntimeChip runtime={runtime} />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-mx-2 h-auto px-2 py-0.5 font-normal text-muted-foreground text-xs"
                    onClick={() => onOpenProviders(boundId)}
                  >
                    {boundAccount ? boundAccount.label : t('followCli')}
                    {translated ? ` · ${t('translated')}` : ''}
                    {cliIdentity === undefined ? '' : ` · ${cliIdentity}`}
                  </Button>
                </div>
                <Switch
                  aria-label={t('enabled')}
                  checked={enabled}
                  disabled={saveProviders.isMutating}
                  onCheckedChange={(next) => {
                    void applyEnabled(kind, next);
                  }}
                />
              </div>
              {cue && (
                <div className="mt-2">
                  <AgentOnboardingCard
                    kind={kind}
                    cue={cue}
                    onDownload={onboarding.download}
                    onContinueUnverified={onboarding.acknowledgeUnverified}
                    onLogin={onboarding.login}
                    onSubmitLoginCode={onboarding.submitLoginCode}
                    onCancelLogin={onboarding.cancelLogin}
                  />
                </div>
              )}
            </div>
          );
        })}
      </SettingsCard>
    </div>
  );
}

/** Probed runtime state, one compact badge: source + version, or missing/unverified/signed-out. */
function RuntimeChip({
  runtime,
}: {
  runtime: AgentRuntimeAvailability | undefined;
}): React.ReactNode {
  const t = useTranslations('settings.agents');
  if (!runtime) return null;
  if (runtime.status === 'missing') return <Badge variant="outline">{t('runtimeMissing')}</Badge>;
  const version = runtime.version === undefined ? '' : ` v${runtime.version}`;
  if (runtime.status === 'out-of-range') {
    return <Badge variant="outline">{t('runtimeUnverified') + version}</Badge>;
  }
  const source = runtime.source === undefined ? '' : t(`runtimeSource.${runtime.source}`);
  return (
    <>
      {source || version ? <Badge variant="outline">{source + version}</Badge> : null}
      {runtime.auth?.loggedIn === false ? <Badge variant="outline">{t('loggedOut')}</Badge> : null}
    </>
  );
}
