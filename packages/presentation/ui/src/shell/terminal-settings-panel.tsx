import { Input } from 'coss-ui/components/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { useId } from 'react';
import { useTranslations } from 'use-intl';
import { SettingsCard, SettingsRow } from './settings-page';
import type { TerminalColorScheme } from './terminal/prefs';
import {
  TERMINAL_COLOR_SCHEMES,
  TERMINAL_FONT_SIZES,
  TERMINAL_FONT_SUGGESTIONS,
} from './terminal/prefs';

export interface TerminalSettingsPanelProps {
  fontFamily: string;
  onFontFamilyChange: (fontFamily: string) => void;
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
  const fontListId = useId();
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
          <Input
            value={fontFamily}
            onChange={(event) => onFontFamilyChange(event.target.value)}
            placeholder={t('fontFamilyPlaceholder')}
            list={fontListId}
            className="w-56"
          />
          <datalist id={fontListId}>
            {TERMINAL_FONT_SUGGESTIONS.map((family) => (
              <option key={family} value={family} />
            ))}
          </datalist>
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
