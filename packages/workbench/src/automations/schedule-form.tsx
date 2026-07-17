import { zodResolver } from '@hookform/resolvers/zod';
import type { ScheduleSpec } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { createSchedule } from '@linkcode/sdk';
import { Button } from 'coss-ui/components/button';
import { Field, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Form } from 'coss-ui/components/form';
import { Input } from 'coss-ui/components/input';
import { RadioGroup, RadioGroupItem } from 'coss-ui/components/radio-group';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { Tabs, TabsList, TabsPanel, TabsTab } from 'coss-ui/components/tabs';
import { Textarea } from 'coss-ui/components/textarea';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { rhfErrorsToFormErrors } from '../lib/form';
import { useMutation } from '../runtime/tayori';
import { CwdField } from './cwd-field';
import { useAutomationsViewStore } from './store';

const INTERVAL_PRESETS = [5, 15, 60, 360, 1440] as const;

const scheduleFormSchema = z
  .object({
    name: z.string().trim().optional(),
    prompt: z.string().trim().min(1),
    kind: AgentKindSchema,
    cwd: z.string().trim().min(1),
    cadenceKind: z.enum(['interval', 'cron']),
    intervalMinutes: z.number().int().min(1),
    cronExpression: z.string().trim(),
    timezone: z.string().trim().optional(),
    misfire: z.enum(['default', 'skip', 'catch-up']),
  })
  .superRefine((draft, ctx) => {
    if (draft.cadenceKind === 'cron' && draft.cronExpression.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['cronExpression'], message: 'required' });
    }
  });

type ScheduleFormDraft = z.infer<typeof scheduleFormSchema>;

function toSpec(draft: ScheduleFormDraft): ScheduleSpec {
  return {
    name: draft.name || undefined,
    prompt: draft.prompt,
    cadence:
      draft.cadenceKind === 'interval'
        ? { type: 'interval', everyMs: draft.intervalMinutes * 60_000 }
        : { type: 'cron', expression: draft.cronExpression, timezone: draft.timezone || undefined },
    target: { type: 'new-session', config: { kind: draft.kind, cwd: draft.cwd } },
    misfirePolicy: draft.misfire === 'default' ? undefined : draft.misfire,
  };
}

/** Create-schedule form (new-session target). Existing-session targets are a later addition. */
export function ScheduleForm(): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const tAgent = useTranslations('workbench.agentKind');
  const select = useAutomationsViewStore((state) => state.select);
  const closeCreate = useAutomationsViewStore((state) => state.closeCreate);
  const create = useMutation(createSchedule);

  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ScheduleFormDraft>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: {
      prompt: '',
      kind: 'claude-code',
      cwd: '',
      cadenceKind: 'interval',
      intervalMinutes: 60,
      cronExpression: '',
      misfire: 'default',
    },
  });

  const onSubmit = handleSubmit(async (draft) => {
    try {
      const schedule = await create.trigger({ spec: toSpec(draft) });
      select(schedule.scheduleId);
    } catch (error) {
      setError('root', {
        message: extractErrorMessage(error, false) ?? 'Failed to create schedule',
      });
    }
  });

  return (
    <Form
      className="flex flex-col gap-4"
      errors={rhfErrorsToFormErrors(errors)}
      onSubmit={onSubmit}
    >
      <Field name="name">
        <FieldLabel>{t('nameLabel')}</FieldLabel>
        <Input
          className="w-full"
          autoComplete="off"
          placeholder={t('namePlaceholder')}
          {...register('name')}
        />
      </Field>

      <Field name="prompt">
        <FieldLabel>{t('promptLabel')}</FieldLabel>
        <Textarea className="w-full" rows={3} {...register('prompt')} />
        <FieldError />
      </Field>

      <Field name="kind">
        <FieldLabel>{t('agentLabel')}</FieldLabel>
        <Controller
          control={control}
          name="kind"
          render={({ field }) => (
            <RadioGroup
              className="flex flex-row flex-wrap gap-2"
              value={field.value}
              onValueChange={field.onChange}
            >
              {AgentKindSchema.options.map((kind) => (
                <label
                  key={kind}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm"
                >
                  <RadioGroupItem value={kind} />
                  {tAgent(kind)}
                </label>
              ))}
            </RadioGroup>
          )}
        />
      </Field>

      <CwdField inputProps={register('cwd')} />

      <Field name="cadenceKind">
        <FieldLabel>{t('schedule.cadenceLabel')}</FieldLabel>
        <Controller
          control={control}
          name="cadenceKind"
          render={({ field }) => (
            <Tabs value={field.value} onValueChange={field.onChange}>
              <TabsList>
                <TabsTab value="interval">{t('schedule.interval')}</TabsTab>
                <TabsTab value="cron">{t('schedule.cron')}</TabsTab>
              </TabsList>
              <TabsPanel value="interval" className="pt-3">
                <Controller
                  control={control}
                  name="intervalMinutes"
                  render={({ field: intervalField }) => (
                    <Select
                      items={INTERVAL_PRESETS.map((minutes) => ({
                        value: minutes,
                        label: t('schedule.everyMinutes', { minutes }),
                      }))}
                      value={intervalField.value}
                      onValueChange={(minutes) => {
                        if (minutes !== null) intervalField.onChange(minutes);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup>
                        {INTERVAL_PRESETS.map((minutes) => (
                          <SelectItem key={minutes} value={minutes}>
                            {t('schedule.everyMinutes', { minutes })}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  )}
                />
              </TabsPanel>
              <TabsPanel value="cron" className="flex flex-col gap-3 pt-3">
                <Input
                  className="w-full font-mono"
                  autoComplete="off"
                  placeholder="0 9 * * 1-5"
                  {...register('cronExpression')}
                />
                <Input
                  className="w-full"
                  autoComplete="off"
                  placeholder={t('schedule.timezonePlaceholder')}
                  {...register('timezone')}
                />
              </TabsPanel>
            </Tabs>
          )}
        />
        <FieldError />
      </Field>

      <Field name="misfire">
        <FieldLabel>{t('schedule.misfireLabel')}</FieldLabel>
        <Controller
          control={control}
          name="misfire"
          render={({ field }) => (
            <RadioGroup
              className="flex flex-row flex-wrap gap-2"
              value={field.value}
              onValueChange={field.onChange}
            >
              {(['default', 'catch-up', 'skip'] as const).map((policy) => (
                <label
                  key={policy}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm"
                >
                  <RadioGroupItem value={policy} />
                  {t(`schedule.misfire.${policy}`)}
                </label>
              ))}
            </RadioGroup>
          )}
        />
      </Field>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={closeCreate}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t('schedule.createSubmit')}
        </Button>
      </div>
    </Form>
  );
}
