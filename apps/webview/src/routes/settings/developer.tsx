import { zodResolver } from '@hookform/resolvers/zod';
import { rhfErrorsToFormErrors } from '@linkcode/workbench/form';
import { usePageTitle } from '@webview/hooks/use-page-title';
import { useSettingsStore } from '@webview/settings/store';
import { Alert, AlertDescription } from 'coss-ui/components/alert';
import { Button } from 'coss-ui/components/button';
import { Field, FieldDescription, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Form } from 'coss-ui/components/form';
import { Input } from 'coss-ui/components/input';
import { TriangleAlertIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { z } from 'zod';

const connectionSchema = z.object({ daemonUrl: z.url() });
type ConnectionForm = z.infer<typeof connectionSchema>;

export function DeveloperSettings(): React.ReactNode {
  const t = useTranslations('settings.developer');
  const tTabs = useTranslations('settings.tabs');
  usePageTitle(tTabs('developer'));

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
  const daemonUrl = useSettingsStore((state) => state.daemonUrl);
  const setDaemonUrl = useSettingsStore((state) => state.setDaemonUrl);

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<ConnectionForm>({
    resolver: zodResolver(connectionSchema),
    defaultValues: { daemonUrl },
  });

  return (
    <Form
      className="flex flex-col gap-4"
      errors={rhfErrorsToFormErrors(errors)}
      onSubmit={handleSubmit(({ daemonUrl: next }) => setDaemonUrl(next))}
    >
      <div>
        <h2 className="font-semibold text-sm">{t('title')}</h2>
        <p className="text-muted-foreground text-xs">{t('hint')}</p>
      </div>
      <Field name="daemonUrl">
        <FieldLabel>{t('url')}</FieldLabel>
        <Input
          className="w-full"
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
