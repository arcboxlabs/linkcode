import { zodResolver } from '@hookform/resolvers/zod';
import type { LoopSpec } from '@linkcode/schema';
import { AgentKindSchema } from '@linkcode/schema';
import { startLoop } from '@linkcode/sdk';
import { Button } from 'coss-ui/components/button';
import { Field, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Form } from 'coss-ui/components/form';
import { Input } from 'coss-ui/components/input';
import { RadioGroup, RadioGroupItem } from 'coss-ui/components/radio-group';
import { Textarea } from 'coss-ui/components/textarea';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { PlusIcon, XIcon } from 'lucide-react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { rhfErrorsToFormErrors } from '../lib/form';
import { useMutation } from '../runtime/tayori';
import { CwdField } from './cwd-field';
import { useAutomationsViewStore } from './store';

const loopFormSchema = z
  .object({
    name: z.string().trim().optional(),
    prompt: z.string().trim().min(1),
    kind: AgentKindSchema,
    cwd: z.string().trim().min(1),
    checks: z.array(z.object({ command: z.string() })),
    verifierPrompt: z.string().trim(),
    maxIterations: z.number().int().min(1).max(100),
    sleepSeconds: z.number().int().nonnegative(),
  })
  .superRefine((draft, ctx) => {
    const hasCheck = draft.checks.some((check) => check.command.trim().length > 0);
    if (!hasCheck && draft.verifierPrompt.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['checks'], message: 'needVerification' });
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
    verifyChecks,
    verifier: draft.verifierPrompt ? { prompt: draft.verifierPrompt } : undefined,
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

  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoopFormDraft>({
    resolver: zodResolver(loopFormSchema),
    defaultValues: {
      prompt: '',
      kind: 'claude-code',
      cwd: '',
      checks: [{ command: '' }],
      verifierPrompt: '',
      maxIterations: 10,
      sleepSeconds: 0,
    },
  });
  const checks = useFieldArray({ control, name: 'checks' });

  const onSubmit = handleSubmit(async (draft) => {
    try {
      const loop = await create.trigger({ spec: toSpec(draft) });
      selectLoop(loop.loopId);
    } catch (error) {
      setError('root', { message: extractErrorMessage(error, false) ?? 'Failed to create loop' });
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
        <FieldLabel>{t('loop.goalLabel')}</FieldLabel>
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
        <FieldError />
      </Field>

      <Field name="verifierPrompt">
        <FieldLabel>{t('loop.verifierLabel')}</FieldLabel>
        <Textarea
          className="w-full"
          rows={2}
          placeholder={t('loop.verifierPromptPlaceholder')}
          {...register('verifierPrompt')}
        />
      </Field>

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
        </Field>
        <Field name="sleepSeconds" className="flex-1">
          <FieldLabel>{t('loop.sleepLabel')}</FieldLabel>
          <Input
            type="number"
            min={0}
            className="w-full"
            {...register('sleepSeconds', { valueAsNumber: true })}
          />
        </Field>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={closeCreate}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {t('loop.createSubmit')}
        </Button>
      </div>
    </Form>
  );
}
