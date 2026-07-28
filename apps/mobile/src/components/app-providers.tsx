import { HeroUINativeProvider } from 'heroui-native';
import { IntlProvider } from 'use-intl';

/** Children-optional wrappers so the root layout can compose providers whose own
 * props declare `children` as required (mirrors workbench's AppI18nProvider pattern). */
export function AppThemeProvider({ children }: React.PropsWithChildren): React.ReactNode {
  return <HeroUINativeProvider>{children}</HeroUINativeProvider>;
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
