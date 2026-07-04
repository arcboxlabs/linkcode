import { Field, FieldDescription, FieldLabel } from 'coss-ui/components/field';
import { RadioGroup, RadioGroupItem } from 'coss-ui/components/radio-group';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { useTranslations } from 'use-intl';

/** Display-layer theme union — apps map their own store's theme type onto this. */
export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_PREFERENCES = new Set<ThemePreference>(['system', 'light', 'dark']);

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && THEME_PREFERENCES.has(value as ThemePreference);
}

export interface GeneralSettingsPanelProps {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  /** Locale override, or null to follow the platform default. */
  locale: string | null;
  onLocaleChange: (locale: string | null) => void;
}

export function GeneralSettingsPanel({
  theme,
  onThemeChange,
  locale,
  onLocaleChange,
}: GeneralSettingsPanelProps): React.ReactNode {
  const t = useTranslations('settings.general');

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
            if (isThemePreference(value)) onThemeChange(value);
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
          value={locale ?? 'auto'}
          onValueChange={(value) => onLocaleChange(value === 'auto' ? null : String(value))}
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

function ThemeOption({ value, label }: { value: string; label: string }): React.ReactNode {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <RadioGroupItem value={value} />
      {label}
    </label>
  );
}
