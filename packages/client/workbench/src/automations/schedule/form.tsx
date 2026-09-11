import { zodResolver } from '@hookform/resolvers/zod';
import type { Schedule, ScheduleSpec } from '@linkcode/schema';
import { SessionIdSchema } from '@linkcode/schema';
import { createSchedule, listSessions, updateSchedule } from '@linkcode/sdk';
import { TaskDisclosure, TaskFormError, TaskSelect } from '@linkcode/ui';
import { Button } from 'coss-ui/components/button';
import { Field, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Form } from 'coss-ui/components/form';
import { Input } from 'coss-ui/components/input';
import { Textarea } from 'coss-ui/components/textarea';
import { useEffect } from 'foxact/use-abortable-effect';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { rhfErrorsToFormErrors } from '../../lib/form';
import { useData, useMutation } from '../../runtime/tayori';
import { CwdField } from '../cwd-field';
import { useAutomationDefaults } from '../defaults';
import { useAutomationDraft } from '../draft-guard';
import { useAutomationDraftState } from '../draft-state';
import { useAutomationsViewStore } from '../store';
import type { ScheduleFormDraft } from './form-model';
import { scheduleCadence, scheduleDraft, scheduleFormSchema, schedulePatch } from './form-model';
import { ScheduleFrequencyFields, ScheduleTimezoneField } from './frequency-fields';
import { useSchedules } from './hooks';

function toSpec(draft: ScheduleFormDraft): ScheduleSpec {
  return {
    name: draft.name || undefined,
    prompt: draft.prompt,
    cadence: scheduleCadence(draft),
    target: draft.targetSession
      ? { type: 'session', sessionId: SessionIdSchema.parse(draft.targetSession) }
      : { type: 'new-session', config: { kind: draft.kind, cwd: draft.cwd } },
    maxRuns: draft.maxRuns ? Number(draft.maxRuns) : undefined,
    expiresAt: draft.expiresAt ? Date.parse(draft.expiresAt) : undefined,
    misfirePolicy: draft.misfire === 'default' ? undefined : draft.misfire,
  };
}

export function ScheduleForm({
  schedule,
  missing = false,
}: {
  schedule?: Schedule;
  missing?: boolean;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const tAgent = useTranslations('workbench.agentKind');
  const select = useAutomationsViewStore((state) => state.select);
  const closeCreate = useAutomationsViewStore((state) => state.closeCreate);
  const create = useMutation(createSchedule);
  const update = useMutation(updateSchedule);
  const defaults = useAutomationDefaults();
  const { mutate } = useSchedules();
  const { data: sessions } = useData(listSessions, schedule ? null : {});

  const {
    control,
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty, dirtyFields },
  } = useForm<ScheduleFormDraft>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: {
      ...scheduleDraft(schedule),
      ...(!schedule && { kind: defaults.kind ?? 'claude-code', cwd: defaults.cwd }),
    },
  });
  useAutomationDraft(isDirty);
  useEffect(() => {
    if (schedule && !isDirty && !isSubmitting) reset(scheduleDraft(schedule));
  }, [schedule, isDirty, isSubmitting, reset]);

  const onSubmit = handleSubmit(async (draft) => {
    try {
      const saved = schedule
        ? await update.trigger({
            scheduleId: schedule.scheduleId,
            patch: schedulePatch(draft, schedule, dirtyFields),
          })
        : await create.trigger({ spec: toSpec(draft) });
      await mutate(
        (current) =>
          current
            ? [...current.filter((entry) => entry.scheduleId !== saved.scheduleId), saved]
            : [saved],
        { revalidate: false },
      );
      reset(scheduleDraft(saved));
      useAutomationDraftState.getState().setDirty(false);
      if (!schedule) select(saved.scheduleId);
    } catch (error) {
      setError('root', {
        message: extractErrorMessage(error, false) ?? t('actionFailed'),
      });
    }
  });

  return (
    <Form
      className="flex flex-col gap-4"
      errors={rhfErrorsToFormErrors(errors)}
      onSubmit={onSubmit}
      aria-busy={isSubmitting}
    >
      <fieldset disabled={isSubmitting} className="flex min-w-0 flex-col gap-4">
        <Field name="name">
          <FieldLabel className="sr-only">{t('nameLabel')}</FieldLabel>
          <Input
            className="w-full border-transparent bg-transparent px-0 font-semibold text-xl shadow-none md:text-xl"
            autoComplete="off"
            placeholder={t('schedule.new')}
            {...register('name')}
          />
        </Field>

        <Field name="prompt">
          <FieldLabel>{t('promptLabel')}</FieldLabel>
          <Textarea className="w-full" rows={3} {...register('prompt')} />
          <FieldError />
        </Field>

        {schedule ? (
          <p className="text-muted-foreground text-sm">
            {schedule.spec.target.type === 'new-session'
              ? `${tAgent(schedule.spec.target.config.kind)} · ${schedule.spec.target.config.cwd}`
              : t('schedule.targetSession')}
          </p>
        ) : (
          <Controller
            control={control}
            name="targetSession"
            render={({ field }) => (
              <>
                <Field name="targetSession">
                  <FieldLabel>{t('schedule.target')}</FieldLabel>
                  <TaskSelect
                    value={field.value}
                    onChange={field.onChange}
                    items={[
                      { value: '', label: t('schedule.targetNewSession') },
                      ...(sessions ?? []).flatMap((session) =>
                        session.automation
                          ? []
                          : [
                              {
                                value: session.sessionId,
                                label: session.title ?? session.sessionId,
                                group: session.cwd,
                              },
                            ],
                      ),
                    ]}
                  />
                </Field>
                {field.value ? null : (
                  <>
                    <Field name="kind">
                      <FieldLabel>{t('agentLabel')}</FieldLabel>
                      <Controller
                        control={control}
                        name="kind"
                        render={({ field }) => (
                          <TaskSelect
                            value={field.value}
                            onChange={field.onChange}
                            items={defaults.kinds.map((kind) => ({
                              value: kind,
                              label: tAgent(kind),
                            }))}
                          />
                        )}
                      />
                    </Field>

                    <Controller
                      control={control}
                      name="cwd"
                      render={({ field }) => (
                        <CwdField value={field.value} onChange={field.onChange} />
                      )}
                    />
                  </>
                )}
              </>
            )}
          />
        )}

        <ScheduleFrequencyFields control={control} register={register} />
        <TaskDisclosure title={t('advanced')} invalid={Boolean(errors.maxRuns || errors.expiresAt)}>
          <ScheduleTimezoneField control={control} register={register} />
          <Field name="maxRuns">
            <FieldLabel>{t('schedule.maxRuns')}</FieldLabel>
            <Input
              type="number"
              min={1}
              placeholder={t('schedule.never')}
              {...register('maxRuns')}
            />
            <FieldError />
          </Field>
          <Field name="expiresAt">
            <FieldLabel>{t('schedule.expiresAt')}</FieldLabel>
            <Input type="datetime-local" {...register('expiresAt')} />
            <FieldError />
          </Field>
          <Field name="misfire">
            <FieldLabel>{t('schedule.misfireLabel')}</FieldLabel>
            <Controller
              control={control}
              name="misfire"
              render={({ field }) => (
                <TaskSelect
                  value={field.value}
                  onChange={field.onChange}
                  items={(['default', 'catch-up', 'skip'] as const).map((policy) => ({
                    value: policy,
                    label: t(`schedule.misfire.${policy}`),
                  }))}
                />
              )}
            />
          </Field>
        </TaskDisclosure>
        <TaskFormError message={errors.root?.message} />
        {missing ? (
          <p role="alert" className="text-destructive text-sm">
            {t('removedDraft')}
          </p>
        ) : null}
        {!schedule && defaults.ready && defaults.kinds.length === 0 ? (
          <p role="alert" className="text-destructive text-sm">
            {t('noHarness')}
          </p>
        ) : null}
        <div className="sticky bottom-0 flex justify-end gap-2 bg-background py-3">
          <Button
            type="button"
            variant="ghost"
            disabled={isSubmitting}
            onClick={() => {
              reset();
              useAutomationDraftState.getState().setDirty(false);
              if (schedule) useAutomationsViewStore.getState().collapse();
              else closeCreate();
            }}
          >
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            disabled={
              isSubmitting ||
              missing ||
              (schedule ? !isDirty : !defaults.ready || defaults.kinds.length === 0)
            }
          >
            {t('save')}
          </Button>
        </div>
      </fieldset>
    </Form>
  );
}
