import type { PluginConfigValue } from '@linkcode/client-core';
import type { LinkCodePluginSettingField, LinkCodePluginSettings } from '@linkcode/schema';
import { Button } from 'coss-ui/components/button';
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from 'coss-ui/components/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from 'coss-ui/components/field';
import { Form } from 'coss-ui/components/form';
import { Input } from 'coss-ui/components/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { Switch } from 'coss-ui/components/switch';
import type { Control, UseFormRegister } from 'react-hook-form';
import { Controller, useForm } from 'react-hook-form';
import { useTranslations } from 'use-intl';
import { rhfErrorsToFormErrors } from '../../lib/form';
import type { PluginConfigFormValues } from './linkcode-config';
import {
  buildPluginConfigPatch,
  pluginConfigDefaults,
  pluginConfigFormKey,
  validatePluginConfigField,
} from './linkcode-config';

export interface LinkCodePluginConfigPatch {
  set?: Record<string, PluginConfigValue>;
  remove?: string[];
}

export interface LinkCodePluginConfigDialogProps {
  /** Display name used in the dialog title. */
  title: string;
  /** The manifest's declared settings — the form renders one control per field. */
  settings: LinkCodePluginSettings;
  /** The masked read: non-secret values only; secret fields arrive absent and render blank. */
  values: Readonly<Record<string, PluginConfigValue>>;
  busy: boolean;
  onClose: () => void;
  onSubmit: (patch: LinkCodePluginConfigPatch) => void;
}

/** The manifest-driven settings form: no zod schema exists for a plugin-declared field set, so
 * per-field `validate` rules stand in for `zodResolver`. */
export function LinkCodePluginConfigDialog({
  title,
  settings,
  values,
  busy,
  onClose,
  onSubmit,
}: LinkCodePluginConfigDialogProps): React.ReactNode {
  const t = useTranslations('settings.plugins.linkcode');
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PluginConfigFormValues>({ defaultValues: pluginConfigDefaults(settings, values) });

  const submit = handleSubmit((form) => onSubmit(buildPluginConfigPatch(settings, values, form)));

  return (
    <Dialog open onOpenChange={(open) => open || onClose()}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('settingsTitle', { title })}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <Form
            className="flex flex-col gap-4"
            errors={rhfErrorsToFormErrors(errors)}
            onSubmit={submit}
          >
            {Object.entries(settings).map(([fieldId, field]) => (
              <ConfigField
                key={fieldId}
                fieldId={fieldId}
                field={field}
                control={control}
                register={register}
                busy={busy}
              />
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {t('form.cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {t('form.save')}
              </Button>
            </div>
          </Form>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function ConfigField({
  fieldId,
  field,
  control,
  register,
  busy,
}: {
  fieldId: string;
  field: LinkCodePluginSettingField;
  control: Control<PluginConfigFormValues>;
  register: UseFormRegister<PluginConfigFormValues>;
  busy: boolean;
}): React.ReactNode {
  const t = useTranslations('settings.plugins.linkcode');
  const label = field.label ?? fieldId;
  // Every RHF name and the <Field name> that pairs errors to it: a dotted setting id must not be
  // read as a nested path (see pluginConfigFormKey).
  const formKey = pluginConfigFormKey(fieldId);

  if (field.type === 'boolean') {
    // Kept out of <Field>: a bare Switch is not a Field control, and base-ui's Fieldset does not
    // propagate disabled — pass it explicitly.
    return (
      <div className="flex items-center justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-medium text-sm">{label}</span>
          {field.description === undefined ? null : (
            <span className="text-muted-foreground text-xs">{field.description}</span>
          )}
        </div>
        <Controller
          control={control}
          name={formKey}
          render={({ field: switchField }) => (
            <Switch
              checked={switchField.value === true}
              disabled={busy}
              onCheckedChange={(checked) => switchField.onChange(checked)}
            />
          )}
        />
      </div>
    );
  }

  const validate = (raw: string | boolean): true | string => {
    const result = validatePluginConfigField(field, raw);
    return result === true ? true : t(`form.${result}`);
  };

  return (
    <Field name={formKey}>
      <FieldLabel>{label}</FieldLabel>
      {field.type === 'enum' ? (
        <Controller
          control={control}
          name={formKey}
          rules={{ validate }}
          render={({ field: selectField }) => (
            <Select
              value={typeof selectField.value === 'string' ? selectField.value : ''}
              onValueChange={(value) => selectField.onChange(value ?? '')}
              disabled={busy}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="">{t('form.selectPlaceholder')}</SelectItem>
                {(field.enum ?? []).map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          )}
        />
      ) : (
        <Input
          {...register(formKey, { validate })}
          type={
            field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'
          }
          placeholder={field.secret ? t('form.secretPlaceholder') : undefined}
          disabled={busy}
        />
      )}
      {field.description === undefined ? null : (
        <FieldDescription>{field.description}</FieldDescription>
      )}
      <FieldError />
    </Field>
  );
}
