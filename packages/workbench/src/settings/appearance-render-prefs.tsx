import { RenderPrefsProvider } from '@linkcode/ui';
import { useAppearancePrefsStore } from './appearance-store';

/**
 * Bridges the shared appearance store into UI's `RenderPrefs` context so presentation components
 * (e.g. the streaming `Shimmer`) can honor the reduce-motion preference. Mounted once at the
 * workbench app root, above every surface that renders motion.
 */
export function AppearanceRenderPrefsProvider({
  children,
}: React.PropsWithChildren): React.ReactNode {
  const reduceMotion = useAppearancePrefsStore((state) => state.reduceMotion);
  return <RenderPrefsProvider prefs={{ reduceMotion }}>{children}</RenderPrefsProvider>;
}
