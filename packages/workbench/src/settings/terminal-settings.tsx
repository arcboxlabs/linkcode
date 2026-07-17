import { TerminalSettingsPanel } from '@linkcode/ui';
import { useTerminalPrefsStore } from './terminal-prefs-store';

/** Wires the shared terminal-prefs store into the presentational {@link TerminalSettingsPanel}. */
export function TerminalSettingsContainer(): React.ReactNode {
  const fontFamily = useTerminalPrefsStore((state) => state.fontFamily);
  const setFontFamily = useTerminalPrefsStore((state) => state.setFontFamily);
  const fontSize = useTerminalPrefsStore((state) => state.fontSize);
  const setFontSize = useTerminalPrefsStore((state) => state.setFontSize);
  const colorScheme = useTerminalPrefsStore((state) => state.colorScheme);
  const setColorScheme = useTerminalPrefsStore((state) => state.setColorScheme);

  return (
    <TerminalSettingsPanel
      fontFamily={fontFamily}
      onFontFamilyChange={setFontFamily}
      fontSize={fontSize}
      onFontSizeChange={setFontSize}
      colorScheme={colorScheme}
      onColorSchemeChange={setColorScheme}
    />
  );
}
