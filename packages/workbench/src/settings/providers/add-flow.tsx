import { zodResolver } from '@hookform/resolvers/zod';
import type { Account, AccountProtocol, AgentRuntimes, EndpointModel } from '@linkcode/schema';
import { listEndpointModels } from '@linkcode/sdk';
import { ServiceIcon } from '@linkcode/ui';
import { Button } from 'coss-ui/components/button';
import { Checkbox } from 'coss-ui/components/checkbox';
import { Field, FieldLabel } from 'coss-ui/components/field';
import { Input } from 'coss-ui/components/input';
import { RadioGroup, RadioGroupItem } from 'coss-ui/components/radio-group';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { Switch } from 'coss-ui/components/switch';
import { noop } from 'foxact/noop';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { ChevronLeftIcon } from 'lucide-react';
import { useState } from 'react';
import type { Control, FieldValues, Path } from 'react-hook-form';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { useMutation } from '../../runtime/tayori';
import type { ServiceDescriptor, ServiceGroup, ServiceVariant } from './catalog';
import { fillTemplate, SERVICE_CATALOG, serviceById, templatePlaceholders } from './catalog';
import type { ImportedProvider, ModelsJsonImport } from './import-models-json';
import { parseModelsJson } from './import-models-json';

const GROUPS: ServiceGroup[] = ['subscription', 'direct', 'gateway', 'custom'];

const SERVICES_BY_GROUP = new Map<ServiceGroup, ServiceDescriptor[]>(
  GROUPS.map((group) => [group, []]),
);
for (const service of SERVICE_CATALOG) SERVICES_BY_GROUP.get(service.group)?.push(service);

/** Account constructors live at module scope: `Date.now` may not run in a component body. */
function newAccountBase(label: string): Pick<Account, 'id' | 'label' | 'createdAt'> {
  return { id: `acc_${crypto.randomUUID()}`, label: label.trim(), createdAt: Date.now() };
}

export function oauthAccount(
  service: Extract<ServiceDescriptor, { kind: 'oauth' }>,
  label: string,
): Account {
  return {
    ...newAccountBase(label),
    service: service.id,
    credential: { type: 'oauth', agent: service.agent },
  };
}

function catalogAccount(
  service: Extract<ServiceDescriptor, { kind: 'endpoint' }>,
  variant: ServiceVariant,
  draft: CatalogDraft,
): Account {
  const trimmed: Record<string, string> = {};
  for (const key of templatePlaceholders(variant.baseUrl)) {
    trimmed[key] = draft.placeholders[key]?.trim() ?? '';
  }
  return {
    ...newAccountBase(draft.label),
    service: service.id,
    credential:
      variant.credentialType === 'auth-token'
        ? { type: 'auth-token', token: draft.secret }
        : { type: 'api-key', key: draft.secret },
    endpoint: { baseUrl: fillTemplate(variant.baseUrl, trimmed), protocol: variant.protocol },
    ...(draft.model.trim() && { model: draft.model.trim() }),
  };
}

function customAccount(draft: CustomDraft): Account {
  const protocol = draft.protocol as AccountProtocol | '';
  return {
    ...newAccountBase(draft.label),
    credential:
      draft.type === 'auth-token'
        ? { type: 'auth-token', token: draft.secret }
        : { type: 'api-key', key: draft.secret },
    ...(draft.baseUrl.trim() &&
      protocol && { endpoint: { baseUrl: draft.baseUrl.trim(), protocol } }),
    ...(draft.models.length > 0 && {
      customProvider: {
        name: draft.providerName.trim(),
        models: draft.models.map((model) => ({
          id: model.id.trim(),
          ...(model.name.trim() && { name: model.name.trim() }),
          reasoning: model.reasoning,
          input: ['text' as const],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: model.contextWindow,
          maxTokens: model.maxTokens,
        })),
      },
    }),
    ...(draft.model.trim() && { model: draft.model.trim() }),
  };
}

function importedAccount(provider: ImportedProvider): Account {
  return {
    ...newAccountBase(provider.name),
    credential: { type: 'api-key', key: provider.apiKey },
    endpoint: { baseUrl: provider.baseUrl, protocol: provider.protocol },
    customProvider: { name: provider.name, models: provider.models },
  };
}

/** Step one of the add flow: the service directory, grouped, taking over the detail pane. */
export function ServiceCatalogView({
  onPick,
  onCancel,
}: {
  onPick: (service: string) => void;
  /** Absent when the pool is empty — the catalog then IS the pane, with nothing to go back to. */
  onCancel?: () => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">{t('chooseService')}</h3>
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            {t('cancel')}
          </Button>
        ) : null}
      </div>
      {GROUPS.map((group) => (
        <div key={group} className="flex flex-col gap-2">
          <span className="font-semibold text-[10px] text-muted-foreground uppercase tracking-widest">
            {t(`group.${group}`)}
          </span>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {(SERVICES_BY_GROUP.get(group) ?? []).map((service) => (
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
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Step two: the per-service seeded form (or the free-form one for `custom`). */
export function AddAccountForm({
  serviceId,
  runtimes,
  busy,
  onBack,
  onSubmit,
  onSubmitMany,
}: {
  serviceId: string;
  runtimes: AgentRuntimes | undefined;
  busy: boolean;
  onBack: () => void;
  onSubmit: (account: Account) => void;
  /** Batch add (the models.json import) — one pool write, so additions cannot race each other. */
  onSubmitMany: (accounts: Account[]) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const service = serviceById(serviceId);
  if (!service) return <ServiceCatalogView onPick={noop} onCancel={onBack} />;
  return (
    <div className="flex min-w-0 max-w-md flex-1 flex-col gap-4">
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
        <OauthCreateForm service={service} runtimes={runtimes} busy={busy} onSubmit={onSubmit} />
      ) : service.kind === 'endpoint' ? (
        <CatalogAccountForm service={service} busy={busy} onSubmit={onSubmit} />
      ) : service.kind === 'import' ? (
        <ImportModelsJsonForm busy={busy} onSubmitMany={onSubmitMany} />
      ) : (
        <CustomAccountForm busy={busy} onSubmit={onSubmit} />
      )}
    </div>
  );
}

/** File-driven variant of the custom form: parse a pi models.json, preview the provider entries,
 * and add every importable one as a custom-provider account in a single pool write. */
function ImportModelsJsonForm({
  busy,
  onSubmitMany,
}: {
  busy: boolean;
  onSubmitMany: (accounts: Account[]) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const [parsed, setParsed] = useState<ModelsJsonImport | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      setParsed(parseModelsJson(await file.text()));
      setParseError(null);
    } catch (err) {
      setParsed(null);
      setParseError(extractErrorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">{t('import.hint')}</p>
      <Input
        type="file"
        accept="application/json,.json"
        className="w-full"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
        }}
      />
      {parseError === null ? null : (
        <p className="text-destructive text-xs">
          {t('import.parseError', { message: parseError })}
        </p>
      )}
      {parsed === null ? null : (
        <>
          <ul className="flex flex-col gap-1">
            {parsed.providers.map((provider) => (
              <li
                key={provider.name}
                className="flex items-start gap-2.5 rounded-lg border border-border p-2.5"
              >
                <ServiceIcon service={undefined} label={provider.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-sm">{provider.name}</span>
                  <span className="block truncate font-mono text-muted-foreground text-xs">
                    {provider.baseUrl} · {provider.protocol}
                  </span>
                </span>
                <span className="shrink-0 text-muted-foreground text-xs">
                  {t('import.modelCount', { count: provider.models.length })}
                </span>
              </li>
            ))}
            {parsed.skipped.map((entry) => (
              <li
                key={entry.name}
                className="flex items-center gap-2.5 rounded-lg border border-border border-dashed p-2.5 text-muted-foreground"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
                <span className="shrink-0 text-xs">{t(`import.reason.${entry.reason}`)}</span>
              </li>
            ))}
          </ul>
          <div>
            <Button
              type="button"
              size="sm"
              disabled={busy || parsed.providers.length === 0}
              onClick={() => onSubmitMany(parsed.providers.map((p) => importedAccount(p)))}
            >
              {t('import.submit', { count: parsed.providers.length })}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** A subscription account delegates to the agent CLI's own login — no secret to collect. A
 * signed-out CLI is still accepted; sessions surface the login error, and in-app login lives on
 * the workbench onboarding card. */
function OauthCreateForm({
  service,
  runtimes,
  busy,
  onSubmit,
}: {
  service: Extract<ServiceDescriptor, { kind: 'oauth' }>;
  runtimes: AgentRuntimes | undefined;
  busy: boolean;
  onSubmit: (account: Account) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const serviceName = t(`serviceName.${service.id}`);
  const [label, setLabel] = useState(serviceName);
  const auth = runtimes?.[service.agent]?.auth;

  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel>{t('form.label')}</FieldLabel>
        <Input
          className="w-full"
          autoComplete="off"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>
      <p className="text-muted-foreground text-xs">
        {auth
          ? auth.loggedIn
            ? [t('loggedIn'), auth.email, auth.method, auth.subscriptionType]
                .filter(Boolean)
                .join(' · ')
            : t('oauthLoggedOutHint')
          : t('oauthUnprobedHint')}
      </p>
      <div>
        <Button
          type="button"
          size="sm"
          disabled={busy || label.trim() === ''}
          onClick={() => onSubmit(oauthAccount(service, label))}
        >
          {t('form.submit')}
        </Button>
      </div>
    </div>
  );
}

const CatalogDraftSchema = z.object({
  label: z.string().min(1),
  secret: z.string().min(1),
  model: z.string(),
  placeholders: z.record(z.string(), z.string()),
});
type CatalogDraft = z.infer<typeof CatalogDraftSchema>;

function catalogDraftSchema(variant: ServiceVariant): typeof CatalogDraftSchema {
  return CatalogDraftSchema.superRefine((draft, ctx) => {
    for (const key of templatePlaceholders(variant.baseUrl)) {
      if (!draft.placeholders[key]?.trim()) {
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
  busy,
  onSubmit,
}: {
  service: Extract<ServiceDescriptor, { kind: 'endpoint' }>;
  busy: boolean;
  onSubmit: (account: Account) => void;
}): React.ReactNode {
  const t = useTranslations('settings.providers');
  const serviceName = t(`serviceName.${service.id}`);
  // The variant determines the form's shape (placeholders, secret kind); it is UI state, not a field.
  const [variant, setVariant] = useState(service.variants[0]);
  const placeholders = templatePlaceholders(variant.baseUrl);

  const {
    register,
    control,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<CatalogDraft>({
    resolver: zodResolver(catalogDraftSchema(variant)),
    defaultValues: { label: serviceName, secret: '', model: '', placeholders: {} },
  });
  // Display-only subscription for the endpoint preview; fields are wired via register/Controller.
  const placeholderValues = useWatch({ control, name: 'placeholders' }) ?? {};

  const secretLabel =
    variant.credentialType === 'auth-token' ? t('credentialAuthToken') : t('credentialApiKey');

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={handleSubmit((draft) => onSubmit(catalogAccount(service, variant, draft)))}
    >
      <Field>
        <FieldLabel>{t('form.label')}</FieldLabel>
        <Input className="w-full" autoComplete="off" {...register('label')} />
      </Field>
      {service.variants.length > 1 ? (
        <Field>
          <FieldLabel>{t('form.variant')}</FieldLabel>
          <RadioGroup
            className="gap-2"
            value={variant.id}
            onValueChange={(value) => {
              const next = service.variants.find((candidate) => candidate.id === value);
              if (next) setVariant(next);
            }}
          >
            {service.variants.map((candidate) => (
              <label
                key={candidate.id}
                className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3"
              >
                <RadioGroupItem value={candidate.id} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block font-medium text-sm">
                    {t(`variantName.${candidate.protocol}`)}
                  </span>
                  <span className="block text-muted-foreground text-xs">
                    {t(`variantNote.${candidate.protocol}`)}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </Field>
      ) : null}
      {placeholders.map((key) => (
        <Field key={`${variant.id}:${key}`}>
          <FieldLabel>{placeholderLabel(key)}</FieldLabel>
          <Input className="w-full" autoComplete="off" {...register(`placeholders.${key}`)} />
        </Field>
      ))}
      <div className="flex gap-3">
        <div className="flex-1">
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
        </div>
        <div className="flex-1">
          <Field>
            <FieldLabel>{t('form.model')}</FieldLabel>
            <Input className="w-full" autoComplete="off" {...register('model')} />
          </Field>
        </div>
      </div>
      <p className="truncate font-mono text-muted-foreground text-xs">
        {fillTemplate(variant.baseUrl, placeholderValues)} · {variant.protocol}
      </p>
      <div>
        <Button type="submit" size="sm" disabled={busy || isSubmitting}>
          {t('form.submit')}
        </Button>
      </div>
    </form>
  );
}

const CustomModelDraftSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  reasoning: z.boolean(),
  contextWindow: z.coerce.number<number>().int().positive(),
  maxTokens: z.coerce.number<number>().int().positive(),
});

const CustomDraftSchema = z
  .object({
    label: z.string().min(1),
    type: z.enum(['api-key', 'auth-token']),
    secret: z.string().min(1),
    baseUrl: z.string(),
    protocol: z.string(),
    model: z.string(),
    providerName: z.string(),
    models: z.array(CustomModelDraftSchema),
  })
  .superRefine((draft, ctx) => {
    // A model list turns the account into a provider definition (pi registerProvider), which
    // needs a provider id and a complete endpoint (the api is derived from the protocol).
    if (draft.models.length === 0) return;
    if (!draft.providerName.trim() || draft.providerName.includes('/')) {
      // Slash-free: the first '/' in a model ref splits provider from model id (schema rule).
      ctx.addIssue({ code: 'custom', path: ['providerName'], message: 'required' });
    }
    if (!draft.baseUrl.trim()) {
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'required' });
    }
    if (!draft.protocol) ctx.addIssue({ code: 'custom', path: ['protocol'], message: 'required' });
  });
type CustomDraft = z.infer<typeof CustomDraftSchema>;

/** The full free-form account form (any endpoint, any protocol) — no catalog seeding. */
function CustomAccountForm({
  busy,
  onSubmit,
}: {
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
    resolver: zodResolver(CustomDraftSchema),
    defaultValues: {
      label: '',
      type: 'api-key',
      secret: '',
      baseUrl: '',
      protocol: '',
      model: '',
      providerName: '',
      models: [],
    },
  });
  const modelRows = useFieldArray({ control, name: 'models' });

  // The "fetch model list" step: query the endpoint's listing API (daemon-proxied) and offer the
  // ids as a checklist. Endpoints without a listing reject — the hint says to fill in manually.
  const fetchModels = useMutation(listEndpointModels);
  const [fetched, setFetched] = useState<EndpointModel[] | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [draftBaseUrl, draftProtocol, draftSecret, draftType] = useWatch({
    control,
    name: ['baseUrl', 'protocol', 'secret', 'type'],
  });
  const canFetch = draftBaseUrl.trim() !== '' && draftProtocol !== '' && draftSecret !== '';

  const handleFetch = async (): Promise<void> => {
    try {
      const models = await fetchModels.trigger({
        baseUrl: draftBaseUrl.trim(),
        protocol: draftProtocol as AccountProtocol,
        secret: draftSecret,
        credentialType: draftType,
      });
      setFetched(models);
      setPicked(new Set());
      setFetchError(null);
    } catch (err) {
      setFetched(null);
      setFetchError(extractErrorMessage(err));
    }
  };

  const addPicked = (): void => {
    for (const model of fetched ?? []) {
      if (!picked.has(model.id)) continue;
      modelRows.append({
        id: model.id,
        name: '',
        reasoning: false,
        contextWindow: model.contextWindow ?? 131072,
        maxTokens: 8192,
      });
    }
    setFetched(null);
    setPicked(new Set());
  };

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
      onSubmit={handleSubmit((draft) => onSubmit(customAccount(draft)))}
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
      <Field>
        <FieldLabel>{t('form.model')}</FieldLabel>
        <Input className="w-full" autoComplete="off" {...register('model')} />
      </Field>
      <div className="flex flex-col gap-2 rounded-lg border border-border border-dashed p-3">
        <div className="flex items-center justify-between">
          <span className="font-medium text-sm">{t('form.customProviderTitle')}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              modelRows.append({
                id: '',
                name: '',
                reasoning: false,
                contextWindow: 131072,
                maxTokens: 8192,
              })
            }
          >
            {t('form.addModel')}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">{t('form.customProviderHint')}</p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canFetch || fetchModels.isMutating}
            onClick={() => {
              void handleFetch();
            }}
          >
            {fetchModels.isMutating ? t('fetchModels.loading') : t('fetchModels.button')}
          </Button>
          {canFetch ? null : (
            <span className="text-muted-foreground text-xs">{t('fetchModels.needsEndpoint')}</span>
          )}
        </div>
        {fetchError === null ? null : (
          <p className="text-muted-foreground text-xs">
            {t('fetchModels.failed', { message: fetchError })}
          </p>
        )}
        {fetched === null ? null : fetched.length === 0 ? (
          <p className="text-muted-foreground text-xs">{t('fetchModels.empty')}</p>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-2">
            <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
              {fetched.map((model) => (
                <label key={model.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={picked.has(model.id)}
                    onCheckedChange={(checked) => {
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(model.id);
                        else next.delete(model.id);
                        return next;
                      });
                    }}
                  />
                  <span className="min-w-0 truncate font-mono text-xs">{model.id}</span>
                </label>
              ))}
            </div>
            <div>
              <Button type="button" size="sm" disabled={picked.size === 0} onClick={addPicked}>
                {t('fetchModels.addPicked', { count: picked.size })}
              </Button>
            </div>
          </div>
        )}
        {modelRows.fields.length > 0 ? (
          <Field>
            <FieldLabel>{t('form.providerName')}</FieldLabel>
            <Input
              className="w-full"
              autoComplete="off"
              placeholder="my-gateway"
              {...register('providerName')}
            />
          </Field>
        ) : null}
        {modelRows.fields.map((row, index) => (
          <div key={row.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <Field>
                  <FieldLabel>{t('form.modelId')}</FieldLabel>
                  <Input
                    className="w-full"
                    autoComplete="off"
                    {...register(`models.${index}.id`)}
                  />
                </Field>
              </div>
              <div className="flex-1">
                <Field>
                  <FieldLabel>{t('form.modelName')}</FieldLabel>
                  <Input
                    className="w-full"
                    autoComplete="off"
                    {...register(`models.${index}.name`)}
                  />
                </Field>
              </div>
            </div>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Field>
                  <FieldLabel>{t('form.contextWindow')}</FieldLabel>
                  <Input
                    type="number"
                    className="w-full"
                    autoComplete="off"
                    {...register(`models.${index}.contextWindow`)}
                  />
                </Field>
              </div>
              <div className="flex-1">
                <Field>
                  <FieldLabel>{t('form.maxTokens')}</FieldLabel>
                  <Input
                    type="number"
                    className="w-full"
                    autoComplete="off"
                    {...register(`models.${index}.maxTokens`)}
                  />
                </Field>
              </div>
              <label className="flex h-9 shrink-0 items-center gap-2 text-sm">
                <Controller
                  control={control}
                  name={`models.${index}.reasoning`}
                  render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
                {t('form.reasoning')}
              </label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => modelRows.remove(index)}
              >
                {t('form.removeModel')}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div>
        <Button type="submit" size="sm" disabled={busy || isSubmitting}>
          {t('form.submit')}
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
