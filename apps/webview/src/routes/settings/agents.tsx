import { zodResolver } from '@hookform/resolvers/zod';
import type {
  Account,
  AccountProtocol,
  Accounts,
  AgentKind,
  ProvidersConfig,
} from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { getAccounts, getProviderConfig, setAccounts, setProviderConfig } from '@linkcode/sdk';
import { usePageTitle } from '@webview/hooks/use-page-title';
import { useData, useMutation } from '@webview/lib/tayori';
import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Field, FieldLabel } from 'coss-ui/components/field';
import { Input } from 'coss-ui/components/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { Switch } from 'coss-ui/components/switch';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import type { AccountPreset } from './account-presets';
import { ACCOUNT_PRESETS } from './account-presets';

const AGENT_KINDS = AgentKindSchema.options;

// ── Per-agent config form (enabled / default model / active account) ─────────

type AgentFormValues = Record<
  AgentKind,
  { enabled: boolean; defaultModel: string; activeAccountId: string }
>;

function toForm(providers: ProvidersConfig | undefined): AgentFormValues {
  const result = {} as AgentFormValues;
  for (const kind of AGENT_KINDS) {
    const config = providers?.[kind];
    result[kind] = {
      enabled: config?.enabled ?? true,
      defaultModel: config?.defaultModel ?? '',
      activeAccountId: config?.activeAccountId ?? '',
    };
  }
  return result;
}

function toConfig(
  values: AgentFormValues,
  providers: ProvidersConfig | undefined,
): ProvidersConfig {
  const result: ProvidersConfig = {};
  for (const kind of AGENT_KINDS) {
    const value = values[kind];
    // Preserve any legacy bare api key (no longer edited here; the account pool supersedes it).
    const legacyApiKey = providers?.[kind]?.apiKey;
    result[kind] = {
      enabled: value.enabled,
      ...(value.defaultModel.trim() && { defaultModel: value.defaultModel.trim() }),
      ...(legacyApiKey && { apiKey: legacyApiKey }),
      ...(value.activeAccountId && { activeAccountId: value.activeAccountId }),
    };
  }
  return result;
}

/** An oauth account is a specific CLI login; other credential kinds can back any agent. */
function accountsForKind(accounts: Accounts, kind: AgentKind): Accounts {
  return accounts.filter(
    (account) => account.credential.type !== 'oauth' || account.credential.agent === kind,
  );
}

function credentialTypeKey(
  type: Account['credential']['type'],
): 'typeApiKey' | 'typeAuthToken' | 'typeOauth' {
  if (type === 'api-key') return 'typeApiKey';
  if (type === 'auth-token') return 'typeAuthToken';
  return 'typeOauth';
}

// ── Add-account form ─────────────────────────────────────────────────────────

const AccountDraftSchema = z.object({
  label: z.string().min(1),
  type: z.enum(['api-key', 'auth-token']),
  secret: z.string().min(1),
  baseUrl: z.string(),
  protocol: z.string(),
  model: z.string(),
});
type AccountDraft = z.infer<typeof AccountDraftSchema>;

const ACCOUNT_DRAFT_DEFAULTS: AccountDraft = {
  label: '',
  type: 'api-key',
  secret: '',
  baseUrl: '',
  protocol: '',
  model: '',
};

function draftToAccount(draft: AccountDraft): Account {
  const credential: Account['credential'] =
    draft.type === 'auth-token'
      ? { type: 'auth-token', token: draft.secret }
      : { type: 'api-key', key: draft.secret };
  const protocol = draft.protocol as AccountProtocol | '';
  return {
    id: `acc_${crypto.randomUUID()}`,
    label: draft.label,
    credential,
    ...(draft.baseUrl && protocol && { endpoint: { baseUrl: draft.baseUrl, protocol } }),
    ...(draft.model && { model: draft.model }),
    createdAt: Date.now(),
  };
}

function AddAccountForm({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: (account: Account) => Promise<void>;
}): React.ReactNode {
  const t = useTranslations('settings.agents');
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<AccountDraft>({
    resolver: zodResolver(AccountDraftSchema),
    defaultValues: ACCOUNT_DRAFT_DEFAULTS,
  });

  const typeItems = [
    { value: 'api-key', label: t('typeApiKey') },
    { value: 'auth-token', label: t('typeAuthToken') },
  ];
  const protocolItems = [
    { value: '', label: t('protocolNone') },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'openai-chat', label: 'OpenAI Chat' },
    { value: 'openai-responses', label: 'OpenAI Responses' },
  ];

  const applyPreset = (preset: AccountPreset): void =>
    reset({
      label: preset.label,
      type: preset.credentialType,
      secret: '',
      baseUrl: preset.baseUrl,
      protocol: preset.protocol,
      model: '',
    });

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border border-dashed p-4"
      onSubmit={handleSubmit(async (draft) => {
        await onAdd(draftToAccount(draft));
        reset(ACCOUNT_DRAFT_DEFAULTS);
      })}
    >
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">{t('presets')}</span>
        <div className="flex flex-wrap gap-2">
          {ACCOUNT_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      </div>
      <Field>
        <FieldLabel>{t('accountLabel')}</FieldLabel>
        <Input className="w-full" autoComplete="off" disabled={disabled} {...register('label')} />
      </Field>
      <div className="flex gap-3">
        <div className="flex-1">
          <Field>
            <FieldLabel>{t('accountType')}</FieldLabel>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select
                  items={typeItems}
                  value={field.value}
                  onValueChange={(value) => {
                    if (value != null) field.onChange(value);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {typeItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              )}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field>
            <FieldLabel>{t('accountSecret')}</FieldLabel>
            <Input
              type="password"
              className="w-full"
              autoComplete="off"
              disabled={disabled}
              {...register('secret')}
            />
          </Field>
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <Field>
            <FieldLabel>{t('accountBaseUrl')}</FieldLabel>
            <Input
              className="w-full"
              autoComplete="off"
              placeholder={t('baseUrlPlaceholder')}
              disabled={disabled}
              {...register('baseUrl')}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field>
            <FieldLabel>{t('accountProtocol')}</FieldLabel>
            <Controller
              control={control}
              name="protocol"
              render={({ field }) => (
                <Select
                  items={protocolItems}
                  value={field.value}
                  onValueChange={(value) => field.onChange(value ?? '')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {protocolItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              )}
            />
          </Field>
        </div>
      </div>
      <Field>
        <FieldLabel>{t('accountModel')}</FieldLabel>
        <Input className="w-full" autoComplete="off" disabled={disabled} {...register('model')} />
      </Field>
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={disabled || isSubmitting}>
          {t('addAccount')}
        </Button>
      </div>
    </form>
  );
}

// ── Accounts pool section ────────────────────────────────────────────────────

function AccountsSection({
  accounts,
  disabled,
  onChange,
}: {
  accounts: Accounts;
  disabled: boolean;
  onChange: (next: Accounts) => Promise<void>;
}): React.ReactNode {
  const t = useTranslations('settings.agents');
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="font-semibold text-sm">{t('accountsTitle')}</h2>
        <p className="text-muted-foreground text-xs">{t('accountsHint')}</p>
      </div>
      {accounts.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('noAccounts')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex items-center gap-3 rounded-lg border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-sm">{account.label}</span>
                  <Badge variant="outline">{t(credentialTypeKey(account.credential.type))}</Badge>
                </div>
                {account.endpoint ? (
                  <span className="block truncate font-mono text-muted-foreground text-xs">
                    {account.endpoint.baseUrl} · {account.endpoint.protocol}
                  </span>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => onChange(accounts.filter((a) => a.id !== account.id))}
              >
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <AddAccountForm disabled={disabled} onAdd={(account) => onChange([...accounts, account])} />
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function AgentsSettings(): React.ReactNode {
  const t = useTranslations('settings.agents');
  const tAgent = useTranslations('workbench.agentKind');
  const tTabs = useTranslations('settings.tabs');
  usePageTitle(tTabs('agents'));
  const {
    data: providers,
    isLoading: providersLoading,
    mutate: mutateProviders,
  } = useData(getProviderConfig, {});
  const { data: accounts, mutate: mutateAccounts } = useData(getAccounts, {});
  const saveProviders = useMutation(setProviderConfig);
  const saveAccounts = useMutation(setAccounts);

  const {
    register,
    control,
    handleSubmit,
    formState: { isDirty },
  } = useForm<AgentFormValues>({ values: toForm(providers) });

  const firstLoadPending = providersLoading && !providers;
  const pool = accounts ?? [];

  const applyAccounts = async (next: Accounts): Promise<void> => {
    await saveAccounts.trigger({ accounts: next });
    void mutateAccounts();
  };

  return (
    <div className="flex flex-col gap-8">
      <AccountsSection
        accounts={pool}
        disabled={saveAccounts.isMutating}
        onChange={applyAccounts}
      />

      <form
        className="flex flex-col gap-6"
        onSubmit={handleSubmit(async (values) => {
          await saveProviders.trigger({ providers: toConfig(values, providers) });
          void mutateProviders();
        })}
      >
        <div>
          <h2 className="font-semibold text-sm">{t('title')}</h2>
          <p className="text-muted-foreground text-xs">{t('hint')}</p>
        </div>

        {/* Disabled is passed explicitly per control: base-ui's Fieldset only propagates
            `disabled` through Field context, which a bare Controller-rendered Switch never
            reads — a submit during first load would overwrite the saved config with defaults. */}
        {AGENT_KINDS.map((kind) => {
          const accountItems = [
            { value: '', label: t('accountNone') },
            ...accountsForKind(pool, kind).map((account) => ({
              value: account.id,
              label: account.label,
            })),
          ];
          return (
            <div key={kind} className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{tAgent(kind)}</span>
                <Controller
                  control={control}
                  name={`${kind}.enabled`}
                  render={({ field }) => (
                    <Switch
                      checked={field.value}
                      disabled={firstLoadPending}
                      onCheckedChange={field.onChange}
                    />
                  )}
                />
              </div>
              <Field>
                <FieldLabel>{t('activeAccount')}</FieldLabel>
                <Controller
                  control={control}
                  name={`${kind}.activeAccountId`}
                  render={({ field }) => (
                    <Select
                      items={accountItems}
                      value={field.value}
                      onValueChange={(value) => field.onChange(value ?? '')}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup>
                        {accountItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  )}
                />
              </Field>
              <Field>
                <FieldLabel>{t('defaultModel')}</FieldLabel>
                <Input
                  className="w-full"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={firstLoadPending}
                  {...register(`${kind}.defaultModel`)}
                />
              </Field>
            </div>
          );
        })}

        <div>
          <Button
            type="submit"
            size="sm"
            disabled={firstLoadPending || !isDirty || saveProviders.isMutating}
          >
            {t('save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
