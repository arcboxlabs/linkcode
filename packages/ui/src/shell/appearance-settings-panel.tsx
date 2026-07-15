import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from 'coss-ui/components/select';
import { Switch } from 'coss-ui/components/switch';
import { useTranslations } from 'use-intl';
import type { CodeThemeDarkId, CodeThemeLightId } from '../code-themes';
import { CODE_THEME_DARK_IDS, CODE_THEME_LABELS, CODE_THEME_LIGHT_IDS } from '../code-themes';
import { cn } from '../lib/cn';
import { SettingsCard, SettingsRow, SettingsSection } from './settings-page';

/** Display-layer theme union — apps map their own store's theme type onto this. */
export type ThemePreference = 'system' | 'light' | 'dark';
/** Display-layer text-size union — mirrors the workbench appearance store's `TextSize`. */
export type TextSize = 'small' | 'default' | 'large';

const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

const THEME_LABEL_KEYS = {
  system: 'themeSystem',
  light: 'themeLight',
  dark: 'themeDark',
} as const;

const TEXT_SIZES: readonly TextSize[] = ['small', 'default', 'large'];

const TEXT_SIZE_LABEL_KEYS = {
  small: 'textSizeSmall',
  default: 'textSizeDefault',
  large: 'textSizeLarge',
} as const;

export interface AppearanceSettingsPanelProps {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  textSize: TextSize;
  onTextSizeChange: (textSize: TextSize) => void;
  reduceMotion: boolean;
  onReduceMotionChange: (reduceMotion: boolean) => void;
  codeThemeLight: CodeThemeLightId;
  onCodeThemeLightChange: (codeThemeLight: CodeThemeLightId) => void;
  codeThemeDark: CodeThemeDarkId;
  onCodeThemeDarkChange: (codeThemeDark: CodeThemeDarkId) => void;
}

export function AppearanceSettingsPanel({
  theme,
  onThemeChange,
  textSize,
  onTextSizeChange,
  reduceMotion,
  onReduceMotionChange,
  codeThemeLight,
  onCodeThemeLightChange,
  codeThemeDark,
  onCodeThemeDarkChange,
}: AppearanceSettingsPanelProps): React.ReactNode {
  const t = useTranslations('settings.appearance');
  const textSizeItems = TEXT_SIZES.map((value) => ({
    value,
    label: t(TEXT_SIZE_LABEL_KEYS[value]),
  }));
  const codeThemeLightItems = CODE_THEME_LIGHT_IDS.map((value) => ({
    value,
    label: CODE_THEME_LABELS[value],
  }));
  const codeThemeDarkItems = CODE_THEME_DARK_IDS.map((value) => ({
    value,
    label: CODE_THEME_LABELS[value],
  }));

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection title={t('theme')}>
        <div className="flex flex-wrap gap-6">
          {THEME_PREFERENCES.map((value) => (
            <ThemePreviewOption
              key={value}
              label={t(THEME_LABEL_KEYS[value])}
              preference={value}
              selected={theme === value}
              onSelect={() => onThemeChange(value)}
            />
          ))}
        </div>
      </SettingsSection>

      <SettingsCard>
        <SettingsRow title={t('textSize')} description={t('textSizeHint')}>
          <Select
            items={textSizeItems}
            value={textSize}
            onValueChange={(value) => {
              const next = TEXT_SIZES.find((size) => size === value);
              if (next) onTextSizeChange(next);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {textSizeItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </SettingsRow>
        <SettingsRow title={t('reduceMotion')} description={t('reduceMotionHint')}>
          <Switch checked={reduceMotion} onCheckedChange={onReduceMotionChange} />
        </SettingsRow>
      </SettingsCard>

      <SettingsCard>
        <SettingsRow title={t('codeThemeLight')} description={t('codeThemeHint')}>
          <Select
            items={codeThemeLightItems}
            value={codeThemeLight}
            onValueChange={(value) => {
              const next = CODE_THEME_LIGHT_IDS.find((id) => id === value);
              if (next) onCodeThemeLightChange(next);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {codeThemeLightItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </SettingsRow>
        <SettingsRow title={t('codeThemeDark')}>
          <Select
            items={codeThemeDarkItems}
            value={codeThemeDark}
            onValueChange={(value) => {
              const next = CODE_THEME_DARK_IDS.find((id) => id === value);
              if (next) onCodeThemeDarkChange(next);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {codeThemeDarkItems.map((item) => (
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

function ThemePreviewOption({
  label,
  preference,
  selected,
  onSelect,
}: {
  label: string;
  preference: ThemePreference;
  selected: boolean;
  onSelect: () => void;
}): React.ReactNode {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className="group flex flex-col items-center gap-2 outline-none"
    >
      <span
        className={cn(
          'relative block h-20 w-32 overflow-hidden rounded-lg border transition-[border-color,box-shadow]',
          selected
            ? 'border-primary ring-2 ring-primary/50'
            : 'border-border group-hover:border-muted-foreground/40 group-focus-visible:ring-2 group-focus-visible:ring-ring',
        )}
      >
        <PreviewPane dark={preference === 'dark'} />
        {/* System splits one window down the middle: a dark copy clipped to the right half. */}
        {preference === 'system' && (
          <span className="absolute inset-0 [clip-path:inset(0_0_0_50%)]">
            <PreviewPane dark />
          </span>
        )}
      </span>
      <span className={cn('text-sm', !selected && 'text-muted-foreground')}>{label}</span>
    </button>
  );
}

/** Fixed-palette window mock — a "light" preview must look light even in dark mode. */
function PreviewPane({ dark = false }: { dark?: boolean }): React.ReactNode {
  return (
    <span
      className={cn(
        'flex h-full w-full flex-col gap-1.5 p-2.5',
        dark ? 'bg-zinc-800' : 'bg-zinc-100',
      )}
    >
      <span className={cn('h-1.5 w-10 rounded-full', dark ? 'bg-zinc-500' : 'bg-zinc-400')} />
      <span
        className={cn(
          'flex flex-1 flex-col gap-1 rounded-md p-1.5',
          dark ? 'bg-zinc-700' : 'bg-white',
        )}
      >
        <span className={cn('h-1 w-3/4 rounded-full', dark ? 'bg-zinc-500' : 'bg-zinc-300')} />
        <span className={cn('h-1 w-1/2 rounded-full', dark ? 'bg-zinc-500' : 'bg-zinc-300')} />
      </span>
    </span>
  );
}
