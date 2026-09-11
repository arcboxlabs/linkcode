import { TaskMultiSelect, TaskSelect } from '@linkcode/ui';
import { Field, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Input } from 'coss-ui/components/input';
import type { Control, UseFormRegister } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import type { ScheduleFormDraft } from './form-model';

const MODES: Array<ScheduleFormDraft['cadenceKind']> = [
  'hourly',
  'daily',
  'weekdays',
  'weekly',
  'monthly',
  'interval',
  'cron',
];

export function ScheduleFrequencyFields({
  control,
  register,
}: {
  control: Control<ScheduleFormDraft>;
  register: UseFormRegister<ScheduleFormDraft>;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  return (
    <Controller
      control={control}
      name="cadenceKind"
      render={({ field }) => (
        <>
          <Field name="cadenceKind">
            <FieldLabel>{t('schedule.cadenceLabel')}</FieldLabel>
            <TaskSelect
              value={field.value}
              onChange={field.onChange}
              items={MODES.map((value) => ({ value, label: t(`schedule.${value}`) }))}
            />
            <FieldError />
          </Field>
          {field.value === 'interval' ? (
            <Field name="intervalMinutes">
              <FieldLabel>{t('schedule.intervalMinutes')}</FieldLabel>
              <Input
                type="number"
                min={1}
                step="any"
                {...register('intervalMinutes', { valueAsNumber: true })}
              />
              <FieldError />
            </Field>
          ) : field.value === 'cron' ? (
            <Field name="cronExpression">
              <FieldLabel>{t('schedule.cron')}</FieldLabel>
              <Input
                className="font-mono"
                placeholder="0 9 * * 1-5"
                {...register('cronExpression')}
              />
              <FieldError />
            </Field>
          ) : (
            <div className="flex flex-wrap gap-3">
              {field.value === 'monthly' ? (
                <Field name="monthDay" className="min-w-24 flex-1">
                  <FieldLabel>{t('schedule.monthDay')}</FieldLabel>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    {...register('monthDay', { valueAsNumber: true })}
                  />
                  <FieldError />
                </Field>
              ) : null}
              {field.value === 'weekly' ? (
                <Field name="weekdays" className="min-w-32 flex-1">
                  <FieldLabel>{t('schedule.weekday')}</FieldLabel>
                  <Controller
                    control={control}
                    name="weekdays"
                    render={({ field: days }) => (
                      <TaskMultiSelect
                        value={days.value.map(String)}
                        onChange={(value) => days.onChange(value.map(Number))}
                        summary={
                          days.value.length === 0
                            ? t('schedule.weekday')
                            : days.value
                                .toSorted((a, b) => a - b)
                                .map((value) => t(`schedule.weekdayNames.${value}`))
                                .join(t('schedule.weekdaySeparator'))
                        }
                        items={[0, 1, 2, 3, 4, 5, 6].map((value) => ({
                          value: String(value),
                          label: t(`schedule.weekdayNames.${value}`),
                        }))}
                      />
                    )}
                  />
                  <FieldError />
                </Field>
              ) : null}
              {field.value === 'hourly' ? null : (
                <Field name="hour" className="min-w-24 flex-1">
                  <FieldLabel>{t('schedule.hour')}</FieldLabel>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    {...register('hour', { valueAsNumber: true })}
                  />
                  <FieldError />
                </Field>
              )}
              <Field name="minute" className="min-w-24 flex-1">
                <FieldLabel>{t('schedule.minute')}</FieldLabel>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  {...register('minute', { valueAsNumber: true })}
                />
                <FieldError />
              </Field>
            </div>
          )}
          {field.value === 'monthly' ? (
            <p className="text-muted-foreground text-xs">{t('schedule.shortMonth')}</p>
          ) : null}
        </>
      )}
    />
  );
}

/** Rendered inside the Advanced-settings disclosure; hidden for interval cadence, which has no timezone concept. */
export function ScheduleTimezoneField({
  control,
  register,
}: {
  control: Control<ScheduleFormDraft>;
  register: UseFormRegister<ScheduleFormDraft>;
}): React.ReactNode {
  const t = useTranslations('workbench.automations');
  return (
    <Controller
      control={control}
      name="cadenceKind"
      render={({ field }) => (
        <>
          {field.value === 'interval' ? null : (
            <Field name="timezone">
              <FieldLabel>{t('schedule.timezone')}</FieldLabel>
              <Input placeholder={t('schedule.timezonePlaceholder')} {...register('timezone')} />
              <FieldError />
            </Field>
          )}
        </>
      )}
    />
  );
}
