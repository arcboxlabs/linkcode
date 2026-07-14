import { GeneralSettingsPanel } from '@linkcode/ui';
import { useDesktopSettingsStore } from './store';

export function GeneralTab(): React.ReactNode {
  const localeOverride = useDesktopSettingsStore((state) => state.localeOverride);
  const setLocaleOverride = useDesktopSettingsStore((state) => state.setLocaleOverride);

  return <GeneralSettingsPanel locale={localeOverride} onLocaleChange={setLocaleOverride} />;
}
