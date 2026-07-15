import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { useTranslations } from 'use-intl';
import { SettingsCard, SettingsRow } from './settings-page';
import type { TerminalColorScheme, TerminalFontFamily } from './terminal/prefs';
import {
  TERMINAL_COLOR_SCHEMES,
  TERMINAL_FONT_FAMILIES,
  TERMINAL_FONT_SIZES,
} from './terminal/prefs';

export interface TerminalSettingsPanelProps {
  fontFamily: TerminalFontFamily;
  onFontFamilyChange: (fontFamily: TerminalFontFamily) => void;
  fontSize: number;
  onFontSizeChange: (fontSize: number) => void;
  colorScheme: TerminalColorScheme;
  onColorSchemeChange: (colorScheme: TerminalColorScheme) => void;
}

export function TerminalSettingsPanel({
  fontFamily,
  onFontFamilyChange,
  fontSize,
  onFontSizeChange,
  colorScheme,
  onColorSchemeChange,
}: TerminalSettingsPanelProps): React.ReactNode {
  const t = useTranslations('settings.terminal');
  const fontFamilyItems = TERMINAL_FONT_FAMILIES.map((value) => ({
    value,
    label: value === 'default' ? t('fontFamilyDefault') : value,
  }));
  const fontSizeItems = TERMINAL_FONT_SIZES.map((value) => ({
    value: String(value),
    label: `${value} px`,
  }));
  const colorSchemeItems = TERMINAL_COLOR_SCHEMES.map((value) => ({
    value,
    label: value === 'auto' ? t('colorSchemeAuto') : value,
  }));

  return (
    <div className="flex flex-col gap-8">
      <SettingsCard>
        <SettingsRow title={t('fontFamily')} description={t('fontFamilyHint')}>
          <Select
            items={fontFamilyItems}
            value={fontFamily}
            onValueChange={(value) => {
              const next = TERMINAL_FONT_FAMILIES.find((family) => family === value);
              if (next) onFontFamilyChange(next);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {fontFamilyItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </SettingsRow>
        <SettingsRow title={t('fontSize')}>
          <Select
            items={fontSizeItems}
            value={String(fontSize)}
            onValueChange={(value) => {
              const next = TERMINAL_FONT_SIZES.find((size) => String(size) === value);
              if (next !== undefined) onFontSizeChange(next);
            }}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {fontSizeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </SettingsRow>
      </SettingsCard>

      <SettingsCard>
        <SettingsRow title={t('colorScheme')} description={t('colorSchemeHint')}>
          <Select
            items={colorSchemeItems}
            value={colorScheme}
            onValueChange={(value) => {
              const next = TERMINAL_COLOR_SCHEMES.find((scheme) => scheme === value);
              if (next) onColorSchemeChange(next);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {colorSchemeItems.map((item) => (
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
