import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { useTranslations } from 'use-intl';
import { SettingsCard, SettingsRow } from './settings-page';

export interface GeneralSettingsPanelProps {
  /** Locale override, or null to follow the platform default. */
  locale: string | null;
  onLocaleChange: (locale: string | null) => void;
}

export function GeneralSettingsPanel({
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
      <SettingsCard>
        <SettingsRow title={t('language')} description={t('languageHint')}>
          <Select
            items={languageItems}
            value={locale ?? 'auto'}
            onValueChange={(value) => onLocaleChange(value === 'auto' ? null : String(value))}
          >
            <SelectTrigger className="w-40">
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
        </SettingsRow>
      </SettingsCard>
    </div>
  );
}
