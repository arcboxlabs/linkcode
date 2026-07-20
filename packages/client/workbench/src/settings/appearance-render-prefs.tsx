import { RenderPrefsProvider } from '@linkcode/ui';
import { useAppearancePrefsStore } from './appearance-store';

/**
 * Bridges the appearance store into UI's `RenderPrefs` context so presentation components can
 * honor the reduce-motion preference. Mounted once at the workbench app root, above all motion.
 */
export function AppearanceRenderPrefsProvider({
  children,
}: React.PropsWithChildren): React.ReactNode {
  const reduceMotion = useAppearancePrefsStore((state) => state.reduceMotion);
  const codeThemeLight = useAppearancePrefsStore((state) => state.codeThemeLight);
  const codeThemeDark = useAppearancePrefsStore((state) => state.codeThemeDark);
  return (
    <RenderPrefsProvider prefs={{ reduceMotion, codeTheme: [codeThemeLight, codeThemeDark] }}>
      {children}
    </RenderPrefsProvider>
  );
}
