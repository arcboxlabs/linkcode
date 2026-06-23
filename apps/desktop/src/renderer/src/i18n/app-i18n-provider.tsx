import { defaultLocale, getMessages, type Locale, resolveLocale } from '@linkcode/i18n';
import type * as React from 'react';
import { type ReactElement, useMemo } from 'react';
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
}>): ReactElement {
  const resolved = locale ?? runtimeLocale();
  const messages = useMemo(() => getMessages(resolved), [resolved]);

  return (
    <IntlProvider locale={resolved} messages={messages}>
      {children}
    </IntlProvider>
  );
}
