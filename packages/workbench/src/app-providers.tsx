import type { Locale } from '@linkcode/i18n';
import { defaultLocale, getMessages, resolveLocale } from '@linkcode/i18n';
import { AnchoredToastProvider, ToastProvider } from 'coss-ui/components/toast';
import type * as React from 'react';
import { useMemo } from 'react';
import { IntlProvider } from 'use-intl';

function runtimeLocale(): Locale {
  if (typeof navigator === 'undefined') return defaultLocale;
  return resolveLocale(navigator.languages);
}

export function AppI18nProvider({
  children,
  locale,
}: React.PropsWithChildren<{
  locale?: Locale;
}>): React.ReactNode {
  const resolved = locale ?? runtimeLocale();
  const messages = useMemo(() => getMessages(resolved), [resolved]);

  return (
    <IntlProvider locale={resolved} messages={messages}>
      {children}
    </IntlProvider>
  );
}

/** Global, app-agnostic providers shared by browser and desktop renderers. */
export function WorkbenchAppProviders({ children }: React.PropsWithChildren): React.ReactNode {
  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <AppI18nProvider>{children}</AppI18nProvider>
      </AnchoredToastProvider>
    </ToastProvider>
  );
}
