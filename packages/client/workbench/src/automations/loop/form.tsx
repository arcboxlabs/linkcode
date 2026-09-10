import { zodResolver } from '@hookform/resolvers/zod';
import type { LoopSpec } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { startLoop } from '@linkcode/sdk';
import { TaskDisclosure, TaskFormError, TaskSelect } from '@linkcode/ui';
import { Button } from 'coss-ui/components/button';
import { Field, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Form } from 'coss-ui/components/form';
import { Input } from 'coss-ui/components/input';
import { Textarea } from 'coss-ui/components/textarea';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { PlusIcon, XIcon } from 'lucide-react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { rhfErrorsToFormErrors } from '../../lib/form';
import { useMutation } from '../../runtime/tayori';
import { CwdField } from '../cwd-field';
import { useAutomationDefaults } from '../defaults';
import { useAutomationDraft } from '../draft-guard';
import { useAutomationDraftState } from '../draft-state';
import { useAutomationsViewStore } from '../store';

const loopFormSchema = z
  .object({
    name: z.string().trim().optional(),
    prompt: z.string().trim().min(1),
    kind: AgentKindSchema,
    cwd: z.string().trim().min(1),
    checks: z.array(z.object({ command: z.string() })),
    verification: z.enum(['agent', 'commands', 'both']),
    verifierPrompt: z.string().trim(),
    maxIterations: z.number().int().min(1).max(100),
    sleepSeconds: z.number().int().nonnegative(),
  })
  .superRefine((draft, ctx) => {
    const hasCheck = draft.checks.some((check) => check.command.trim().length > 0);
    if (!hasCheck && draft.verification !== 'agent') {
      ctx.addIssue({ code: 'custom', path: ['checks'], message: 'needVerification' });
    }
    if (!draft.verifierPrompt && draft.verification !== 'commands') {
      ctx.addIssue({ code: 'custom', path: ['verifierPrompt'], message: 'needVerification' });
    }
  });

type LoopFormDraft = z.infer<typeof loopFormSchema>;

function toSpec(draft: LoopFormDraft): LoopSpec {
  const verifyChecks = draft.checks.flatMap((check) => {
    const command = check.command.trim();
    return command ? [command] : [];
  });
  return {
    name: draft.name || undefined,
    kind: draft.kind,
    cwd: draft.cwd,
    prompt: draft.prompt,
    verifyChecks: draft.verification === 'agent' ? [] : verifyChecks,
    verifier: draft.verification === 'commands' ? undefined : { prompt: draft.verifierPrompt },
    maxIterations: draft.maxIterations,
    sleepMs: draft.sleepSeconds * 1000,
  };
}

/** Create-loop form. A non-empty verifier prompt configures the structured verifier. */
export function LoopForm(): React.ReactNode {
  const t = useTranslations('workbench.automations');
  const tAgent = useTranslations('workbench.agentKind');
  const selectLoop = useAutomationsViewStore((state) => state.selectLoop);
  const closeCreate = useAutomationsViewStore((state) => state.closeCreate);
  const create = useMutation(startLoop);
  const defaults = useAutomationDefaults();

  const {
    control,
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<LoopFormDraft>({
    resolver: zodResolver(loopFormSchema),
    defaultValues: {
      prompt: '',
      kind: defaults.kind ?? 'claude-code',
      cwd: defaults.cwd,
      verification: 'agent',
      checks: [{ command: '' }],
      verifierPrompt: '',
      maxIterations: 10,
      sleepSeconds: 0,
    },
  });
  const checks = useFieldArray({ control, name: 'checks' });
  useAutomationDraft(isDirty);

  const onSubmit = handleSubmit(async (draft) => {
    try {
      const loop = await create.trigger({ spec: toSpec(draft) });
      reset(draft);
      useAutomationDraftState.getState().setDirty(false);
      selectLoop(loop.loopId);
    } catch (error) {
      setError('root', { message: extractErrorMessage(error, false) ?? t('actionFailed') });
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
          <FieldLabel>{t('nameLabel')}</FieldLabel>
          <Input
            className="w-full"
            autoComplete="off"
            placeholder={t('loop.new')}
            {...register('name')}
          />
        </Field>

        <Field name="prompt">
          <FieldLabel>{t('loop.goalLabel')}</FieldLabel>
          <Textarea className="w-full" rows={3} {...register('prompt')} />
          <FieldError />
        </Field>

        <Controller
          control={control}
          name="cwd"
          render={({ field }) => <CwdField value={field.value} onChange={field.onChange} />}
        />

        <Field name="kind">
          <FieldLabel>{t('agentLabel')}</FieldLabel>
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <TaskSelect
                value={field.value}
                onChange={field.onChange}
                items={defaults.kinds.map((kind) => ({ value: kind, label: tAgent(kind) }))}
              />
            )}
          />
        </Field>

        <Controller
          control={control}
          name="verification"
          render={({ field }) => (
            <>
              <Field name="verification">
                <FieldLabel>{t('loop.verification')}</FieldLabel>
                <TaskSelect
                  value={field.value}
                  onChange={field.onChange}
                  items={(['agent', 'commands', 'both'] as const).map((value) => ({
                    value,
                    label: t(`loop.verificationMethods.${value}`),
                  }))}
                />
              </Field>
              {field.value === 'agent' ? null : (
                <Field name="checks">
                  <FieldLabel>{t('loop.verifyChecksLabel')}</FieldLabel>
                  <p className="text-muted-foreground text-xs">{t('loop.verifyChecksHint')}</p>
                  <div className="flex flex-col gap-2">
                    {checks.fields.map((item, index) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <Input
                          className="w-full font-mono"
                          autoComplete="off"
                          placeholder={t('loop.checkPlaceholder')}
                          {...register(`checks.${index}.command`)}
                        />
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={t('loop.removeCheck')}
                          disabled={checks.fields.length === 1}
                          onClick={() => checks.remove(index)}
                        >
                          <XIcon className="size-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="self-start"
                      onClick={() => checks.append({ command: '' })}
                    >
                      <PlusIcon className="size-4" />
                      {t('loop.addCheck')}
                    </Button>
                  </div>
                  {errors.checks ? (
                    <p role="alert" className="text-destructive text-sm">
                      {t('loop.needVerification')}
                    </p>
                  ) : null}
                </Field>
              )}

              {field.value === 'commands' ? null : (
                <Field name="verifierPrompt">
                  <FieldLabel>{t('loop.verifierPromptLabel')}</FieldLabel>
                  <Textarea
                    className="w-full"
                    rows={2}
                    placeholder={t('loop.verifierPromptPlaceholder')}
                    {...register('verifierPrompt')}
                  />
                  {errors.verifierPrompt ? (
                    <p role="alert" className="text-destructive text-sm">
                      {t('loop.needVerification')}
                    </p>
                  ) : null}
                </Field>
              )}
            </>
          )}
        />

        <TaskDisclosure
          title={t('advanced')}
          invalid={Boolean(errors.maxIterations || errors.sleepSeconds)}
        >
          <div className="flex gap-3">
            <Field name="maxIterations" className="flex-1">
              <FieldLabel>{t('loop.maxIterationsLabel')}</FieldLabel>
              <Input
                type="number"
                min={1}
                max={100}
                className="w-full"
                {...register('maxIterations', { valueAsNumber: true })}
              />
              <FieldError />
            </Field>
            <Field name="sleepSeconds" className="flex-1">
              <FieldLabel>{t('loop.sleepLabel')}</FieldLabel>
              <Input
                type="number"
                min={0}
                className="w-full"
                {...register('sleepSeconds', { valueAsNumber: true })}
              />
              <FieldError />
            </Field>
          </div>
        </TaskDisclosure>

        <TaskFormError message={errors.root?.message} />
        {defaults.ready && defaults.kinds.length === 0 ? (
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
              useAutomationDraftState.getState().setDirty(false);
              closeCreate();
            }}
          >
            {t('cancel')}
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || !defaults.ready || defaults.kinds.length === 0}
          >
            {t('loop.createSubmit')}
          </Button>
        </div>
      </fieldset>
    </Form>
  );
}
