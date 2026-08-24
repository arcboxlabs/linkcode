import { zodResolver } from '@hookform/resolvers/zod';
import type { EndpointService, ServiceDescriptor, ServiceGroup } from '@linkcode/providers';
import {
  LINKCODE_GATEWAY_SERVICE_ID,
  modelListSource,
  pinnedEndpoint,
  SERVICE_CATALOG,
  serviceById,
  serviceProtocols,
  templatePlaceholders,
} from '@linkcode/providers';
import type {
  Account,
  AccountModel,
  AccountProtocol,
  AccountSecret,
  AgentKind,
  AgentRuntimes,
} from '@linkcode/schema';
import { AccountModelSchema } from '@linkcode/schema';
import { AgentOnboardingCard, ServiceIcon } from '@linkcode/ui';
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
import { extractErrorMessage } from 'foxts/extract-error-message';
import { isObjectEmpty } from 'foxts/is-object-empty';
import { ChevronLeftIcon } from 'lucide-react';
import { useState } from 'react';
import type { Control, FieldValues, Path } from 'react-hook-form';
import { Controller, useForm } from 'react-hook-form';
import { useLocale, useTranslations } from 'use-intl';
import { z } from 'zod';
import type { AgentRuntimeOnboarding } from '../../agent-runtime/onboarding';
import type { ModelSources } from './model-selection';
import { ModelSelection } from './model-selection';

const GROUPS: ServiceGroup[] = ['subscription', 'direct', 'gateway', 'custom'];

const SERVICES_BY_GROUP = new Map<ServiceGroup, ServiceDescriptor[]>(
  GROUPS.map((group) => [group, []]),
);
for (const service of SERVICE_CATALOG) SERVICES_BY_GROUP.get(service.group)?.push(service);

/**
 * Two-axis restricted-brand filter (CODE-618) for the add-account catalog only: oauth entries by
 * their bound agent, everything else (endpoint services and `custom`) by service id. `custom`
 * gets no special case — it is a plain catalog id like any other, so the id-set intersection
 * excludes it on its own whenever a brand declares `services` without naming it. `serviceById`,
 * the account list/detail, and account resolution stay unfiltered everywhere else: an account
 * created under a service this build no longer offers must keep resolving and rendering.
 */
export function isServiceSelectable(
  service: ServiceDescriptor,
  allowedAgents: readonly AgentKind[] | null,
  allowedServices: readonly string[] | null,
): boolean {
  if (service.kind === 'oauth') {
    return allowedAgents === null || allowedAgents.includes(service.agent);
  }
  return allowedServices === null || allowedServices.includes(service.id);
}

/** Account constructors live at module scope: `Date.now` may not run in a component body. */
function newAccountBase(label: string): Pick<Account, 'id' | 'label' | 'createdAt'> {
  return { id: `acc_${crypto.randomUUID()}`, label: label.trim(), createdAt: Date.now() };
}

function oauthAccount(
  service: Extract<ServiceDescriptor, { kind: 'oauth' }>,
  label: string,
  models: AccountModel[],
): Account {
  return {
    ...newAccountBase(label),
    service: service.id,
    credential: { type: 'oauth', agent: service.agent },
    models,
  };
}

/** The account holds only the secret, the service key and any template values — each agent resolves
 * its own endpoint from those, so no protocol is chosen here. */
function catalogAccount(service: EndpointService, draft: CatalogDraft): Account {
  const trimmed: Record<string, string> = {};
  for (const key of servicePlaceholders(service)) {
    const value = Object.hasOwn(draft.placeholders, key) ? draft.placeholders[key] : '';
    trimmed[key] = value.trim();
  }
  return {
    ...newAccountBase(draft.label),
    service: service.id,
    credential:
      service.credentialType === 'auth-token'
        ? { type: 'auth-token', token: draft.secret }
        : { type: 'api-key', key: draft.secret },
    ...(!isObjectEmpty(trimmed) && { endpointParams: trimmed }),
    models: draft.models,
  };
}

/** Placeholders across every variant: one secret covers them all, so the form asks once. */
function servicePlaceholders(service: EndpointService): string[] {
  const keys = new Set<string>();
  for (const variant of Object.values(service.variants)) {
    for (const key of templatePlaceholders(variant.baseUrl)) keys.add(key);
  }
  return [...keys];
}

function customAccount(draft: CustomDraft): Account {
  return accountFromCustomDraft(draft);
}

/** Update an account in place while preserving its identity and fields outside the editor. */
export function updateAccountFromDraft(account: Account, draft: CustomDraft): Account {
  return accountFromCustomDraft(draft, account);
}

function accountFromCustomDraft(draft: CustomDraft, account?: Account): Account {
  const protocol = draft.protocol as AccountProtocol | '';
  const base =
    account === undefined
      ? newAccountBase(draft.label)
      : (({
          credential: _credential,
          endpoint: _endpoint,
          label: _label,
          models: _models,
          ...rest
        }) => rest)(account);
  return {
    ...base,
    label: draft.label.trim(),
    credential:
      draft.type === 'auth-token'
        ? { type: 'auth-token', token: draft.secret }
        : { type: 'api-key', key: draft.secret },
    ...(draft.baseUrl.trim() &&
      protocol && { endpoint: { baseUrl: draft.baseUrl.trim(), protocol } }),
    ...(draft.models.length > 0 && { models: draft.models }),
  };
}

/** Step one of the add flow: the grouped service directory. */
export function ServiceCatalogView({
  onPick,
  linkCodeGatewayAvailable = false,
  allowedAgents = null,
  allowedServices = null,
}: {
  onPick: (service: string) => void;
  linkCodeGatewayAvailable?: boolean;
  /** Restricted-brand allowlists (CODE-618); `null` (the default) means unrestricted. */
  allowedAgents?: readonly AgentKind[] | null;
  allowedServices?: readonly string[] | null;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const locale = useLocale();
  // tracking-widest (0.1em) inflates Latin glyphs beside CJK, making e.g. "API" in
  // "API 直连" read as full-width. CJK glyphs carry natural sidebearings, so skip it.
  const groupLabelTracking = locale.startsWith('zh') ? '' : ' tracking-widest';
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      {GROUPS.map((group) => (
        <div key={group} className="flex flex-col gap-2">
          <span
            className={`font-semibold text-2xs text-muted-foreground uppercase${groupLabelTracking}`}
          >
            {t(`group.${group}`)}
          </span>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {(SERVICES_BY_GROUP.get(group) ?? []).map((service) =>
              (!linkCodeGatewayAvailable && service.id === LINKCODE_GATEWAY_SERVICE_ID) ||
              !isServiceSelectable(service, allowedAgents, allowedServices) ? null : (
                <button
                  key={service.id}
                  type="button"
                  className="flex items-start gap-2.5 rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted/50"
                  onClick={() => onPick(service.id)}
                >
                  <ServiceIcon service={service.id} label={service.label} className="size-7" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-sm">
                      {t(`serviceName.${service.id}`)}
                    </span>
                    <span className="block text-muted-foreground text-xs">
                      {t(`serviceHint.${service.id}`)}
                    </span>
                  </span>
                </button>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Step two: the per-service seeded form (or the free-form one for `custom`). */
export function AddAccountForm({
  serviceId,
  sources,
  runtimes,
  onboarding,
  busy,
  onBack,
  onSubmit,
  linkCodeGateway,
}: {
  serviceId: string;
  sources?: ModelSources;
  runtimes: AgentRuntimes | undefined;
  onboarding: AgentRuntimeOnboarding;
  busy: boolean;
  onBack: () => void;
  onSubmit: (account: Account) => void;
  linkCodeGateway?: LinkCodeGatewayAccess;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const service = serviceById(serviceId);
  if (!service) return null;
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>
          <ChevronLeftIcon className="size-4" />
          {t('chooseService')}
        </Button>
      </div>
      <div className="flex items-center gap-2.5">
        <ServiceIcon service={service.id} label={service.label} />
        <h3 className="font-semibold text-sm">{t(`serviceName.${service.id}`)}</h3>
      </div>
      {service.kind === 'oauth' ? (
        <OauthCreateForm
          service={service}
          sources={sources}
          runtimes={runtimes}
          onboarding={onboarding}
          busy={busy}
          onSubmit={onSubmit}
        />
      ) : service.kind === 'endpoint' && service.id === LINKCODE_GATEWAY_SERVICE_ID ? (
        <LinkCodeGatewayForm
          service={service}
          access={linkCodeGateway}
          sources={sources}
          busy={busy}
          onSubmit={onSubmit}
        />
      ) : service.kind === 'endpoint' ? (
        <CatalogAccountForm service={service} sources={sources} busy={busy} onSubmit={onSubmit} />
      ) : (
        <CustomAccountForm sources={sources} busy={busy} onSubmit={onSubmit} />
      )}
    </div>
  );
}

export interface LinkCodeGatewayAccess {
  signedIn: boolean;
  signingIn: boolean;
  signIn: () => void;
  createKey: (name: string) => Promise<string>;
}

const LinkCodeGatewayDraftSchema = z.object({ label: z.string().trim().min(1).max(80) });
type LinkCodeGatewayDraft = z.infer<typeof LinkCodeGatewayDraftSchema>;

function LinkCodeGatewayForm({
  service,
  access,
  sources,
  busy,
  onSubmit,
}: {
  service: Extract<ServiceDescriptor, { kind: 'endpoint' }>;
  access: LinkCodeGatewayAccess | undefined;
  sources: ModelSources | undefined;
  busy: boolean;
  onSubmit: (account: Account) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LinkCodeGatewayDraft>({
    resolver: zodResolver(LinkCodeGatewayDraftSchema),
    defaultValues: { label: t(`serviceName.${service.id}`) },
  });
  const [createdKey, setCreatedKey] = useState<string | undefined>(undefined);

  if (!access?.signedIn) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">{t('linkCodeSignInHint')}</p>
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            disabled={!access || access.signingIn}
            onClick={access?.signIn}
          >
            {access?.signingIn ? t('linkCodeConnecting') : t('linkCodeSignIn')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={handleSubmit(async ({ label }) => {
        try {
          if (!sources) throw new Error(t('models.fetchFailed'));
          const key = createdKey ?? (await access.createKey(label));
          setCreatedKey(key);
          const credential: AccountSecret = { type: 'auth-token', token: key };
          const models = await sources.probeInline(service.id, credential);
          if (models.length === 0) throw new Error(t('models.required'));
          onSubmit({
            ...newAccountBase(label),
            service: service.id,
            credential,
            models,
          });
        } catch (error) {
          setError('root', {
            message: extractErrorMessage(error, false) ?? t('linkCodeGatewayError'),
          });
        }
      })}
    >
      <Field>
        <FieldLabel>{t('form.label')}</FieldLabel>
        <Input className="w-full" autoComplete="off" {...register('label')} />
      </Field>
      <p className="text-muted-foreground text-xs">{t('linkCodeGatewayOptIn')}</p>
      {errors.root?.message ? (
        <p role="alert" className="text-destructive-foreground text-xs">
          {errors.root.message}
        </p>
      ) : null}
      <div className="flex justify-end pt-1">
        <Button type="submit" size="sm" disabled={busy || isSubmitting || !sources}>
          {t('linkCodeUseGateway')}
        </Button>
      </div>
    </form>
  );
}

/** Existing-account editor shown inside the account management dialog. */
export function EditAccountForm({
  account,
  sources,
  busy,
  onBack,
  onSubmit,
}: {
  account: Account;
  sources?: ModelSources;
  busy: boolean;
  onBack: () => void;
  onSubmit: (account: Account) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const service = serviceById(account.service);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <div>
        <Button type="button" size="sm" variant="ghost" onClick={onBack}>
          <ChevronLeftIcon className="size-4" />
          {t('backToAccount')}
        </Button>
      </div>
      <div className="flex items-center gap-2.5">
        <ServiceIcon service={account.service} label={account.label} />
        <h3 className="font-semibold text-sm">
          {service ? t(`serviceName.${service.id}`) : account.label}
        </h3>
      </div>
      {account.credential.type === 'oauth' ? (
        <OauthEditForm account={account} sources={sources} busy={busy} onSubmit={onSubmit} />
      ) : (
        <CustomAccountForm account={account} sources={sources} busy={busy} onSubmit={onSubmit} />
      )}
    </div>
  );
}

const OauthEditDraftSchema = z.object({
  label: z.string().min(1),
  models: z.array(AccountModelSchema),
});
type OauthEditDraft = z.infer<typeof OauthEditDraftSchema>;

function OauthEditForm({
  account,
  sources,
  busy,
  onSubmit,
}: {
  account: Account;
  sources?: ModelSources;
  busy: boolean;
  onSubmit: (account: Account) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const {
    register,
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<OauthEditDraft>({
    resolver: zodResolver(OauthEditDraftSchema),
    defaultValues: { label: account.label, models: account.models ?? [] },
  });
  const agent = account.credential.type === 'oauth' ? account.credential.agent : undefined;
  const fetchModels = agent === undefined || !sources ? undefined : () => sources.oauth(agent);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={handleSubmit((draft) =>
        onSubmit({
          ...account,
          label: draft.label.trim(),
          ...(draft.models.length > 0 ? { models: draft.models } : { models: undefined }),
        }),
      )}
    >
      <Field>
        <FieldLabel>{t('form.label')}</FieldLabel>
        <Input className="w-full" autoComplete="off" {...register('label')} />
      </Field>
      <Controller
        control={control}
        name="models"
        render={({ field }) => (
          <ModelSelection
            disabled={busy}
            onChange={field.onChange}
            onFetch={fetchModels}
            selected={field.value}
          />
        )}
      />
      <p className="text-muted-foreground text-xs">{t('oauthEditHint')}</p>
      <div className="flex justify-end pt-1">
        <Button type="submit" size="sm" disabled={busy || isSubmitting}>
          {t('form.save')}
        </Button>
      </div>
    </form>
  );
}

/** Subscription accounts are persisted only after the agent CLI login succeeds. */
function OauthCreateForm({
  service,
  sources,
  runtimes,
  onboarding,
  busy,
  onSubmit,
}: {
  service: Extract<ServiceDescriptor, { kind: 'oauth' }>;
  sources?: ModelSources;
  runtimes: AgentRuntimes | undefined;
  onboarding: AgentRuntimeOnboarding;
  busy: boolean;
  onSubmit: (account: Account) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const serviceName = t(`serviceName.${service.id}`);
  const [label, setLabel] = useState(serviceName);
  const [models, setModels] = useState<AccountModel[]>([]);
  const fetchModels = sources ? () => sources.oauth(service.agent) : undefined;
  const auth = runtimes?.[service.agent]?.auth;
  const loggedIn = auth?.loggedIn === true;
  const cue = onboarding.cues[service.agent] ?? { state: 'needs-login', phase: 'idle' as const };
  const loginInProgress =
    cue.state === 'needs-login' && (cue.phase === 'opening' || cue.phase === 'awaiting-code');
  const hasModels = models.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel>{t('form.label')}</FieldLabel>
        <Input
          className="w-full"
          autoComplete="off"
          disabled={busy || loginInProgress}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>
      <ModelSelection
        disabled={busy || loginInProgress}
        onChange={setModels}
        onFetch={fetchModels}
        required
        selected={models}
      />
      {loggedIn ? (
        <>
          <p className="text-muted-foreground text-xs">
            {[t('loggedIn'), auth.email, auth.method, auth.subscriptionType]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="flex justify-end pt-1">
            <Button
              type="button"
              size="sm"
              disabled={busy || label.trim() === '' || !hasModels}
              onClick={() => onSubmit(oauthAccount(service, label, models))}
            >
              {t('form.submit')}
            </Button>
          </div>
        </>
      ) : (
        <AgentOnboardingCard
          kind={service.agent}
          cue={cue}
          onDownload={onboarding.download}
          onContinueUnverified={onboarding.acknowledgeUnverified}
          onLogin={
            !hasModels || busy || label.trim() === ''
              ? undefined
              : (kind) => {
                  onboarding.login(kind, () => onSubmit(oauthAccount(service, label, models)));
                }
          }
          onSubmitLoginCode={onboarding.submitLoginCode}
          onCancelLogin={onboarding.cancelLogin}
        />
      )}
    </div>
  );
}

const CatalogDraftSchema = z.object({
  label: z.string().min(1),
  secret: z.string().min(1),
  placeholders: z.record(z.string(), z.string()),
  models: z.array(AccountModelSchema).min(1),
});
type CatalogDraft = z.infer<typeof CatalogDraftSchema>;

function catalogDraftSchema(service: EndpointService): typeof CatalogDraftSchema {
  return CatalogDraftSchema.superRefine((draft, ctx) => {
    for (const key of servicePlaceholders(service)) {
      const value = Object.hasOwn(draft.placeholders, key) ? draft.placeholders[key] : '';
      if (!value.trim()) {
        ctx.addIssue({ code: 'custom', path: ['placeholders', key], message: 'required' });
      }
    }
  });
}

function placeholderLabel(key: string): string {
  return key
    .split('_')
    .map((word) => (word === 'id' ? 'ID' : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

function CatalogAccountForm({
  service,
  sources,
  busy,
  onSubmit,
}: {
  service: EndpointService;
  sources?: ModelSources;
  busy: boolean;
  onSubmit: (account: Account) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const serviceName = t(`serviceName.${service.id}`);
  const placeholders = servicePlaceholders(service);

  const {
    register,
    control,
    getValues,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<CatalogDraft>({
    resolver: zodResolver(catalogDraftSchema(service)),
    defaultValues: { label: serviceName, secret: '', placeholders: {}, models: [] },
  });

  const secretLabel =
    service.credentialType === 'auth-token' ? t('credentialAuthToken') : t('credentialApiKey');

  /** The secret is read at click time rather than watched: the button stays enabled and says what
   * is missing, instead of subscribing the whole form to every keystroke. */
  const fetchModels =
    sources && service.models
      ? async (): Promise<AccountModel[]> => {
          const secret = getValues('secret');
          if (!secret) throw new Error(t('models.secretFirst'));
          return sources.probeInline(
            service.id,
            service.credentialType === 'auth-token'
              ? { type: 'auth-token', token: secret }
              : { type: 'api-key', key: secret },
          );
        }
      : undefined;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={handleSubmit((draft) => onSubmit(catalogAccount(service, draft)))}
    >
      <Field>
        <FieldLabel>{t('form.label')}</FieldLabel>
        <Input className="w-full" autoComplete="off" {...register('label')} />
      </Field>
      {placeholders.map((key) => (
        <Field key={key}>
          <FieldLabel>{placeholderLabel(key)}</FieldLabel>
          <Input className="w-full" autoComplete="off" {...register(`placeholders.${key}`)} />
        </Field>
      ))}
      <Field>
        <FieldLabel>{secretLabel}</FieldLabel>
        <Input
          type="password"
          className="w-full"
          autoComplete="off"
          placeholder={service.secretPlaceholder}
          {...register('secret')}
        />
      </Field>
      <Controller
        control={control}
        name="models"
        render={({ field }) => (
          <ModelSelection
            disabled={busy}
            onChange={field.onChange}
            onFetch={fetchModels}
            required
            selected={field.value}
          />
        )}
      />
      <p className="mt-1 truncate font-mono text-muted-foreground text-xs">
        {serviceProtocols(service.id).join(' · ')}
      </p>
      <div className="flex justify-end pt-1">
        <Button type="submit" size="sm" disabled={busy || isSubmitting}>
          {t('form.submit')}
        </Button>
      </div>
    </form>
  );
}

const CustomDraftSchema = z.object({
  label: z.string().min(1),
  type: z.enum(['api-key', 'auth-token']),
  secret: z.string().min(1),
  baseUrl: z.string(),
  protocol: z.string(),
  models: z.array(AccountModelSchema),
});
const CustomCreateDraftSchema = CustomDraftSchema.extend({
  models: z.array(AccountModelSchema).min(1),
});
type CustomDraft = z.infer<typeof CustomDraftSchema>;

/** The full free-form account form (any endpoint, any protocol) — no catalog seeding. */
function CustomAccountForm({
  account,
  sources,
  busy,
  onSubmit,
}: {
  account?: Account;
  sources?: ModelSources;
  busy: boolean;
  onSubmit: (account: Account) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const {
    register,
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<CustomDraft>({
    resolver: zodResolver(account === undefined ? CustomCreateDraftSchema : CustomDraftSchema),
    defaultValues: {
      label: account?.label ?? '',
      type:
        account?.credential.type === 'auth-token' || account?.credential.type === 'api-key'
          ? account.credential.type
          : 'api-key',
      secret:
        account?.credential.type === 'auth-token'
          ? account.credential.token
          : account?.credential.type === 'api-key'
            ? account.credential.key
            : '',
      // Prefill only an endpoint that is actually honored: a catalog-derived one is ignored at
      // resolve time, so showing it would invite the user to "keep" a value that does nothing.
      baseUrl: (account && pinnedEndpoint(account)?.baseUrl) ?? '',
      protocol: (account && pinnedEndpoint(account)?.protocol) ?? '',
      models: account?.models ?? [],
    },
  });
  // A saved account is probed by id so its stored secret stays on the daemon side. A custom account
  // names no service, so nothing can list its models and the set stays freeform.
  const service = account?.service;
  const fetchModels =
    sources !== undefined &&
    account !== undefined &&
    service !== undefined &&
    modelListSource(service) !== undefined
      ? (): Promise<AccountModel[]> => sources.probeAccount(service, account.id)
      : undefined;

  const typeItems = [
    { value: 'api-key', label: t('credentialApiKey') },
    { value: 'auth-token', label: t('credentialAuthToken') },
  ];
  const protocolItems = [
    { value: '', label: t('form.protocolNone') },
    { value: 'anthropic', label: 'Anthropic' },
    { value: 'openai-chat', label: 'OpenAI Chat' },
    { value: 'openai-responses', label: 'OpenAI Responses' },
  ];

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={handleSubmit((draft) =>
        onSubmit(
          account === undefined ? customAccount(draft) : updateAccountFromDraft(account, draft),
        ),
      )}
    >
      <Field>
        <FieldLabel>{t('form.label')}</FieldLabel>
        <Input className="w-full" autoComplete="off" {...register('label')} />
      </Field>
      <div className="flex gap-3">
        <div className="flex-1">
          <Field>
            <FieldLabel>{t('form.credentialType')}</FieldLabel>
            <SimpleSelect control={control} name="type" items={typeItems} />
          </Field>
        </div>
        <div className="flex-1">
          <Field>
            <FieldLabel>{t('form.secret')}</FieldLabel>
            <Input type="password" className="w-full" autoComplete="off" {...register('secret')} />
          </Field>
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <Field>
            <FieldLabel>{t('form.baseUrl')}</FieldLabel>
            <Input
              className="w-full"
              autoComplete="off"
              placeholder="https://…"
              {...register('baseUrl')}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field>
            <FieldLabel>{t('form.protocol')}</FieldLabel>
            <SimpleSelect control={control} name="protocol" items={protocolItems} />
          </Field>
        </div>
      </div>
      <Controller
        control={control}
        name="models"
        render={({ field }) => (
          <ModelSelection
            disabled={busy}
            onChange={field.onChange}
            onFetch={fetchModels}
            required={account === undefined}
            selected={field.value}
          />
        )}
      />
      <div className="flex justify-end pt-1">
        <Button type="submit" size="sm" disabled={busy || isSubmitting}>
          {account === undefined ? t('form.submit') : t('form.save')}
        </Button>
      </div>
    </form>
  );
}

function SimpleSelect<T extends FieldValues>({
  control,
  name,
  items,
}: {
  control: Control<T>;
  name: Path<T>;
  items: Array<{ value: string; label: string }>;
}): React.ReactNode {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select
          items={items}
          value={field.value}
          onValueChange={(value) => field.onChange(value ?? '')}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      )}
    />
  );
}
