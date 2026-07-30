import { HeroUINativeProvider } from 'heroui-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { IntlProvider } from 'use-intl';

/** Children-optional wrappers so the root layout can compose providers whose own
 * props declare `children` as required (mirrors workbench's AppI18nProvider pattern). */
export function AppThemeProvider({ children }: React.PropsWithChildren): React.ReactNode {
  return <HeroUINativeProvider>{children}</HeroUINativeProvider>;
}

/** Feeds keyboard frames to `KeyboardStickyView` so the composer tracks the keyboard. */
export function AppKeyboardProvider({ children }: React.PropsWithChildren): React.ReactNode {
  return <KeyboardProvider>{children}</KeyboardProvider>;
}

export function AppIntlProvider({
  locale,
  messages,
  children,
}: React.PropsWithChildren<{
  locale: React.ComponentProps<typeof IntlProvider>['locale'];
  messages: React.ComponentProps<typeof IntlProvider>['messages'];
}>): React.ReactNode {
  return (
    <IntlProvider locale={locale} messages={messages}>
      {children}
    </IntlProvider>
  );
}
