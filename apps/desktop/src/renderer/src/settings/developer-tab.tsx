import { zodResolver } from '@hookform/resolvers/zod';
import { useWorkbenchRuntimeEndpoint } from '@linkcode/workbench';
import { rhfErrorsToFormErrors } from '@linkcode/workbench/form';
import { Alert, AlertDescription } from 'coss-ui/components/alert';
import { Button } from 'coss-ui/components/button';
import { Field, FieldDescription, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Form } from 'coss-ui/components/form';
import { Input } from 'coss-ui/components/input';
import { TriangleAlertIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';
import { useDesktopSettingsStore } from './store';

// Empty submits as null, which falls back to auto-discovery — see setDaemonUrl below.
const connectionSchema = z.object({
  daemonUrl: z
    .string()
    .transform((value) => value.trim())
    .pipe(z.union([z.literal(''), z.url()])),
});
type ConnectionForm = z.infer<typeof connectionSchema>;

export function DeveloperTab(): React.ReactNode {
  const t = useTranslations('settings.developer');

  return (
    <div className="flex flex-col gap-6">
      <Alert variant="warning">
        <TriangleAlertIcon />
        <AlertDescription>{t('warning')}</AlertDescription>
      </Alert>
      <ConnectionSection />
    </div>
  );
}

function ConnectionSection(): React.ReactNode {
  const t = useTranslations('settings.connection');
  const daemonUrl = useWorkbenchRuntimeEndpoint();
  const daemonUrlOverride = useDesktopSettingsStore((state) => state.daemonUrlOverride);
  const setDaemonUrl = useDesktopSettingsStore((state) => state.setDaemonUrl);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ConnectionForm>({
    resolver: zodResolver(connectionSchema),
    defaultValues: { daemonUrl: daemonUrlOverride ?? '' },
  });

  return (
    <Form
      className="flex flex-col gap-4"
      errors={rhfErrorsToFormErrors(errors)}
      onSubmit={handleSubmit(async ({ daemonUrl: next }) => {
        await setDaemonUrl(next === '' ? null : next);
        // Rebase the form's baseline to the saved value so `isDirty` compares against the current
        // setting, not the mount-time default — otherwise re-typing the old value falsely reads clean.
        reset({ daemonUrl: next });
      })}
    >
      <div>
        <h2 className="font-semibold text-sm">{t('title')}</h2>
        <p className="text-muted-foreground text-xs">{t('hint')}</p>
      </div>
      <Field name="daemonUrl">
        <FieldLabel>{t('url')}</FieldLabel>
        <Input
          className="w-full"
          placeholder={daemonUrl}
          spellCheck={false}
          autoComplete="off"
          {...register('daemonUrl')}
        />
        <FieldDescription>{t('urlHint')}</FieldDescription>
        <FieldError />
      </Field>
      <div>
        <Button type="submit" size="sm" disabled={!isDirty}>
          {t('save')}
        </Button>
      </div>
    </Form>
  );
}
