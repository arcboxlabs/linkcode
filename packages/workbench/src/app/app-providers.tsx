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

// Client-rendered app: the device zone is authoritative. Configured globally so `format.dateTime`
// doesn't fall back per call-site (use-intl logs ENVIRONMENT_FALLBACK otherwise).
const runtimeTimeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;

export function AppI18nProvider({
  children,
  locale,
}: React.PropsWithChildren<{
  locale?: Locale;
}>): React.ReactNode {
  const resolved = locale ?? runtimeLocale();
  const messages = useMemo(() => getMessages(resolved), [resolved]);

  return (
    <IntlProvider locale={resolved} messages={messages} timeZone={runtimeTimeZone}>
      {children}
    </IntlProvider>
  );
}

/**
 * Global, app-agnostic providers shared by browser and desktop renderers.
 * `locale` is a raw override (e.g. from a settings store); unset follows the runtime.
 */
export function WorkbenchAppProviders({
  children,
  locale,
}: React.PropsWithChildren<{ locale?: string | null }>): React.ReactNode {
  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <AppI18nProvider locale={locale ? resolveLocale(locale) : undefined}>
          {children}
        </AppI18nProvider>
      </AnchoredToastProvider>
    </ToastProvider>
  );
}
