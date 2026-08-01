import { zodResolver } from '@hookform/resolvers/zod';
import type { Account, AccountModel, AccountSecret, AgentKind } from '@linkcode/schema';
import { AccountProtocolSchema } from '@linkcode/schema';
import {
  createAndBindAccount,
  getAccounts,
  getProviderConfig,
  probeAccountModels,
} from '@linkcode/sdk';
import { AGENT_LABELS } from '@linkcode/ui';
import { Button } from 'coss-ui/components/button';
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from 'coss-ui/components/dialog';
import { Field, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Form } from 'coss-ui/components/form';
import { Input } from 'coss-ui/components/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { Loader2Icon } from 'lucide-react';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { rhfErrorsToFormErrors } from '../../lib/form';
import { useData, useMutation } from '../../runtime/tayori';
import { nativeAccountProtocol } from '../../settings/providers/capability';
import { useAgentApiKeyLoginStore } from './store';

const DraftSchema = z.object({
  label: z.string().trim().min(1),
  baseUrl: z.url(),
  protocol: AccountProtocolSchema,
  credentialType: z.enum(['api-key', 'auth-token']),
  secret: z.string().trim().min(1),
  model: z.string().trim(),
});
type Draft = z.infer<typeof DraftSchema>;

function draftSecret(draft: Pick<Draft, 'credentialType' | 'secret'>): AccountSecret {
  return draft.credentialType === 'auth-token'
    ? { type: 'auth-token', token: draft.secret.trim() }
    : { type: 'api-key', key: draft.secret.trim() };
}

function detectionKey(
  draft: Pick<Draft, 'baseUrl' | 'credentialType' | 'protocol' | 'secret'>,
): string {
  return JSON.stringify([
    draft.baseUrl.trim(),
    draft.credentialType,
    draft.protocol,
    draft.secret.trim(),
  ]);
}

/** Account constructor at module scope: `Date.now` may not run in a component body. */
function accountFromDraft(id: string, draft: Draft): Account {
  return {
    id,
    label: draft.label.trim(),
    credential: draftSecret(draft),
    endpoint: { baseUrl: draft.baseUrl.trim(), protocol: draft.protocol },
    ...(draft.model.trim() && { model: draft.model.trim() }),
    createdAt: Date.now(),
  };
}

/**
 * The API-key branch of the Providers settings setup flow: a relay/gateway key plus its base URL,
 * saved as a normal pool account and bound as the agent's active one.
 */
export function AgentApiKeyLoginDialog(): React.ReactNode {
  const kind = useAgentApiKeyLoginStore((state) => state.kind);
  const accountId = useAgentApiKeyLoginStore((state) => state.accountId);
  const close = useAgentApiKeyLoginStore((state) => state.close);
  const t = useTranslations('workbench.apiKeyLogin');

  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && close()}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('title', { agent: kind ? AGENT_LABELS[kind] : '' })}</DialogTitle>
          <DialogDescription>{t('hint')}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {/* Keyed per agent so switching agents starts from that agent's own defaults. */}
          {kind !== null && accountId !== null && (
            <ApiKeyLoginForm key={accountId} kind={kind} accountId={accountId} onDone={close} />
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function ApiKeyLoginForm({
  kind,
  accountId,
  onDone,
}: {
  kind: AgentKind;
  accountId: string;
  onDone: () => void;
}): React.ReactNode {
  const t = useTranslations('workbench.apiKeyLogin');
  const { mutate: mutateAccounts } = useData(getAccounts, {});
  const { mutate: mutateProviders } = useData(getProviderConfig, {});
  const save = useMutation(createAndBindAccount);
  const probe = useMutation(probeAccountModels);
  // Detection result and its failure are transient UI state, not part of the submitted draft.
  const [detected, setDetected] = useState<AccountModel[] | null>(null);
  const [detectError, setDetectError] = useState<string | null>(null);
  const probeGenerationRef = useRef(0);

  const {
    control,
    register,
    handleSubmit,
    getValues,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Draft>({
    resolver: zodResolver(DraftSchema),
    defaultValues: {
      label: t('defaultLabel', { agent: AGENT_LABELS[kind] }),
      baseUrl: '',
      protocol: nativeAccountProtocol(kind),
      credentialType: 'api-key',
      secret: '',
      model: '',
    },
  });
  const baseUrlField = register('baseUrl');
  const secretField = register('secret');

  const onSubmit = handleSubmit(async (draft) => {
    try {
      const account = accountFromDraft(accountId, draft);
      await save.trigger({ agent: kind, account });
      await Promise.all([mutateAccounts(), mutateProviders()]);
      onDone();
    } catch (error) {
      setError('root', { message: extractErrorMessage(error, false) ?? t('saveFailed') });
    }
  });

  function invalidateDetection(): void {
    probeGenerationRef.current += 1;
    if (detected !== null) setValue('model', '');
    setDetected(null);
    setDetectError(null);
  }

  // Imperative read: detection is an action on the current values, not a field subscription.
  async function detect(): Promise<void> {
    const generation = ++probeGenerationRef.current;
    const draft = getValues();
    const key = detectionKey(draft);
    setDetectError(null);
    const endpoint = z
      .object({ baseUrl: z.url(), protocol: AccountProtocolSchema })
      .safeParse({ baseUrl: draft.baseUrl.trim(), protocol: draft.protocol });
    if (!endpoint.success || draft.secret.trim() === '') {
      setDetectError(t('detectNeedsEndpoint'));
      return;
    }
    try {
      const models = await probe.trigger({ endpoint: endpoint.data, secret: draftSecret(draft) });
      if (generation !== probeGenerationRef.current || key !== detectionKey(getValues())) return;
      setDetected(models);
      if (models.length === 0) setDetectError(t('detectEmpty'));
    } catch (error) {
      if (generation !== probeGenerationRef.current || key !== detectionKey(getValues())) return;
      setDetected(null);
      setDetectError(extractErrorMessage(error, false) ?? t('detectFailed'));
    }
  }

  const protocolItems = AccountProtocolSchema.options.map((protocol) => ({
    value: protocol,
    label: t(`protocol.${protocol}`),
  }));
  const credentialItems = [
    { value: 'api-key', label: t('credentialApiKey') },
    { value: 'auth-token', label: t('credentialAuthToken') },
  ];

  return (
    <Form
      className="flex flex-col gap-3"
      errors={rhfErrorsToFormErrors(errors)}
      onSubmit={onSubmit}
    >
      <Field name="label">
        <FieldLabel>{t('labelField')}</FieldLabel>
        <Input className="w-full" autoComplete="off" {...register('label')} />
        <FieldError />
      </Field>
      <Field name="baseUrl">
        <FieldLabel>{t('baseUrl')}</FieldLabel>
        <Input
          className="w-full"
          autoComplete="off"
          placeholder={t('baseUrlPlaceholder')}
          {...baseUrlField}
          onChange={(event) => {
            void baseUrlField.onChange(event);
            invalidateDetection();
          }}
        />
        <FieldError />
      </Field>
      <div className="flex gap-3">
        <div className="flex-1">
          <Field name="credentialType">
            <FieldLabel>{t('credentialType')}</FieldLabel>
            <Controller
              control={control}
              name="credentialType"
              render={({ field }) => (
                <DraftSelect
                  items={credentialItems}
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    invalidateDetection();
                  }}
                />
              )}
            />
          </Field>
        </div>
        <div className="flex-1">
          <Field name="protocol">
            <FieldLabel>{t('protocol.field')}</FieldLabel>
            <Controller
              control={control}
              name="protocol"
              render={({ field }) => (
                <DraftSelect
                  items={protocolItems}
                  value={field.value}
                  onValueChange={(value) => {
                    field.onChange(value);
                    invalidateDetection();
                  }}
                />
              )}
            />
          </Field>
        </div>
      </div>
      <Field name="secret">
        <FieldLabel>{t('secret')}</FieldLabel>
        <Input
          type="password"
          className="w-full"
          autoComplete="off"
          {...secretField}
          onChange={(event) => {
            void secretField.onChange(event);
            invalidateDetection();
          }}
        />
        <FieldError />
      </Field>
      <Field name="model">
        <FieldLabel>{t('model')}</FieldLabel>
        <div className="flex gap-2">
          {detected && detected.length > 0 ? (
            <Controller
              control={control}
              name="model"
              render={({ field }) => (
                <DraftSelect
                  items={detected.map((model) => ({
                    value: model.id,
                    label: model.label ?? model.id,
                  }))}
                  value={field.value}
                  onValueChange={field.onChange}
                />
              )}
            />
          ) : (
            <Input
              className="w-full"
              autoComplete="off"
              placeholder={t('modelPlaceholder')}
              {...register('model')}
            />
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={probe.isMutating}
            onClick={() => {
              void detect();
            }}
          >
            {probe.isMutating && <Loader2Icon className="size-4 animate-spin" />}
            {t('detect')}
          </Button>
        </div>
        {detectError !== null && <span className="text-destructive text-xs">{detectError}</span>}
        {detected && detected.length > 0 && detectError === null && (
          <span className="text-muted-foreground text-xs">
            {t('detectCount', { count: detected.length })}
          </span>
        )}
      </Field>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={isSubmitting || save.isMutating}>
          {t('save')}
        </Button>
      </div>
    </Form>
  );
}

function DraftSelect({
  items,
  value,
  onValueChange,
}: {
  items: Array<{ value: string; label: string }>;
  value: string;
  onValueChange: (value: string) => void;
}): React.ReactNode {
  return (
    <Select items={items} value={value} onValueChange={(next) => onValueChange(next ?? '')}>
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
  );
}
