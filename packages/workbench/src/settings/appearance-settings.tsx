import type { ThemePreference } from '@linkcode/ui';
import { AppearanceSettingsPanel } from '@linkcode/ui';
import { useAppearancePrefsStore } from './appearance-store';

export interface AppearanceSettingsContainerProps {
  /** Theme lives in each app's own store (system plane on desktop), so it is passed in. */
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}

/**
 * Wires the shared appearance store into the presentational {@link AppearanceSettingsPanel}. The
 * theme control is app-owned and threaded through as props; everything else reads the store here so
 * both apps' Appearance tabs stay in sync without duplicating the store reads.
 */
export function AppearanceSettingsContainer({
  theme,
  onThemeChange,
}: AppearanceSettingsContainerProps): React.ReactNode {
  const textSize = useAppearancePrefsStore((state) => state.textSize);
  const setTextSize = useAppearancePrefsStore((state) => state.setTextSize);
  const reduceMotion = useAppearancePrefsStore((state) => state.reduceMotion);
  const setReduceMotion = useAppearancePrefsStore((state) => state.setReduceMotion);
  const codeThemeLight = useAppearancePrefsStore((state) => state.codeThemeLight);
  const setCodeThemeLight = useAppearancePrefsStore((state) => state.setCodeThemeLight);
  const codeThemeDark = useAppearancePrefsStore((state) => state.codeThemeDark);
  const setCodeThemeDark = useAppearancePrefsStore((state) => state.setCodeThemeDark);
  const uiFont = useAppearancePrefsStore((state) => state.uiFont);
  const setUiFont = useAppearancePrefsStore((state) => state.setUiFont);
  const codeFont = useAppearancePrefsStore((state) => state.codeFont);
  const setCodeFont = useAppearancePrefsStore((state) => state.setCodeFont);

  return (
    <AppearanceSettingsPanel
      theme={theme}
      onThemeChange={onThemeChange}
      textSize={textSize}
      onTextSizeChange={setTextSize}
      reduceMotion={reduceMotion}
      onReduceMotionChange={setReduceMotion}
      codeThemeLight={codeThemeLight}
      onCodeThemeLightChange={setCodeThemeLight}
      codeThemeDark={codeThemeDark}
      onCodeThemeDarkChange={setCodeThemeDark}
      uiFont={uiFont}
      onUiFontChange={setUiFont}
      codeFont={codeFont}
      onCodeFontChange={setCodeFont}
    />
  );
}
