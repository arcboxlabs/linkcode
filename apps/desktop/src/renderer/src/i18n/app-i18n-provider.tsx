import type { Locale } from '@linkcode/i18n';
import { defaultLocale, getMessages, resolveLocale } from '@linkcode/i18n';
import type * as React from 'react';
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
  const messages = getMessages(resolved);

  return (
    <IntlProvider locale={resolved} messages={messages}>
      {children}
    </IntlProvider>
  );
}
