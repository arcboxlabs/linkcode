import { ThemePreferenceSchema } from '@linkcode/ipc';
import { Field, FieldDescription, FieldLabel } from 'coss-ui/components/field';
import { RadioGroup, RadioGroupItem } from 'coss-ui/components/radio-group';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import type { ReactNode } from 'react';
import { useTranslations } from 'use-intl';
import { useDesktopAppConfig } from '../app-config-context';

export function GeneralTab(): ReactNode {
  const t = useTranslations('settings.general');
  const { theme, setTheme, localeOverride, setLocaleOverride } = useDesktopAppConfig();

  const languageItems = [
    { value: 'auto', label: t('languageAuto') },
    { value: 'en', label: 'English' },
    { value: 'zh-CN', label: '简体中文' },
  ];

  return (
    <div className="flex flex-col gap-8">
      <Field>
        <FieldLabel>{t('theme')}</FieldLabel>
        <FieldDescription>{t('appearanceHint')}</FieldDescription>
        <RadioGroup
          className="mt-1 flex-row gap-5"
          value={theme}
          onValueChange={(value) => {
            const parsed = ThemePreferenceSchema.safeParse(value);
            if (parsed.success) setTheme(parsed.data);
          }}
        >
          <ThemeOption value="system" label={t('themeSystem')} />
          <ThemeOption value="light" label={t('themeLight')} />
          <ThemeOption value="dark" label={t('themeDark')} />
        </RadioGroup>
      </Field>

      <Field>
        <FieldLabel>{t('language')}</FieldLabel>
        <FieldDescription>{t('languageHint')}</FieldDescription>
        <Select
          items={languageItems}
          value={localeOverride ?? 'auto'}
          onValueChange={(value) => setLocaleOverride(value === 'auto' ? null : String(value))}
        >
          <SelectTrigger className="mt-1 w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {languageItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </Field>
    </div>
  );
}

function ThemeOption({ value, label }: { value: string; label: string }): ReactNode {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <RadioGroupItem value={value} />
      {label}
    </label>
  );
}
