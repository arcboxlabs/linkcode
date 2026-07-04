import type { AgentKind, ProvidersConfig } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { getProviderConfig, setProviderConfig } from '@linkcode/sdk';
import { usePageTitle } from '@webview/hooks/use-page-title';
import { useData, useMutation } from '@webview/lib/tayori';
import { Button } from 'coss-ui/components/button';
import { Field, FieldLabel } from 'coss-ui/components/field';
import { Input } from 'coss-ui/components/input';
import { Switch } from 'coss-ui/components/switch';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';

const AGENT_KINDS = AgentKindSchema.options;

type AgentFormValues = Record<
  AgentKind,
  { enabled: boolean; defaultModel: string; apiKey: string }
>;

function toForm(providers: ProvidersConfig | undefined): AgentFormValues {
  const result = {} as AgentFormValues;
  for (const kind of AGENT_KINDS) {
    const config = providers?.[kind];
    result[kind] = {
      enabled: config?.enabled ?? true,
      defaultModel: config?.defaultModel ?? '',
      apiKey: config?.apiKey ?? '',
    };
  }
  return result;
}

function toConfig(values: AgentFormValues): ProvidersConfig {
  const result: ProvidersConfig = {};
  for (const kind of AGENT_KINDS) {
    const value = values[kind];
    result[kind] = {
      enabled: value.enabled,
      ...(value.defaultModel.trim() && { defaultModel: value.defaultModel.trim() }),
      ...(value.apiKey && { apiKey: value.apiKey }),
    };
  }
  return result;
}

export function AgentsSettings(): React.ReactNode {
  const t = useTranslations('settings.agents');
  const tAgent = useTranslations('workbench.agentKind');
  const tTabs = useTranslations('settings.tabs');
  usePageTitle(tTabs('agents'));
  const { data, isLoading, mutate } = useData(getProviderConfig, {});
  const save = useMutation(setProviderConfig);

  const {
    register,
    control,
    handleSubmit,
    formState: { isDirty },
  } = useForm<AgentFormValues>({ values: toForm(data) });

  const firstLoadPending = isLoading && !data;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={handleSubmit(async (values) => {
        await save.trigger({ providers: toConfig(values) });
        void mutate();
      })}
    >
      <div>
        <h2 className="font-semibold text-sm">{t('title')}</h2>
        <p className="text-muted-foreground text-xs">{t('hint')}</p>
      </div>

      {/* Disabled is passed explicitly per control: base-ui's Fieldset only propagates
          `disabled` through Field context, which a bare Controller-rendered Switch never
          reads — a submit during first load would overwrite the saved config with defaults. */}
      {AGENT_KINDS.map((kind) => (
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
            <FieldLabel>{t('defaultModel')}</FieldLabel>
            <Input
              className="w-full"
              spellCheck={false}
              autoComplete="off"
              disabled={firstLoadPending}
              {...register(`${kind}.defaultModel`)}
            />
          </Field>
          <Field>
            <FieldLabel>{t('apiKey')}</FieldLabel>
            <Input
              type="password"
              className="w-full"
              autoComplete="off"
              placeholder={t('apiKeyPlaceholder')}
              disabled={firstLoadPending}
              {...register(`${kind}.apiKey`)}
            />
          </Field>
        </div>
      ))}

      <div>
        <Button type="submit" size="sm" disabled={firstLoadPending || !isDirty || save.isMutating}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
