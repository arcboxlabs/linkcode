import type { Locale } from '@linkcode/i18n';
import { AppI18nProvider } from '@webview/providers/app-i18n-provider';
import { AnchoredToastProvider, ToastProvider } from 'coss-ui/components/toast';
import type * as React from 'react';
import type { ReactNode } from 'react';

/**
 * Global, route-agnostic providers — the SPA analogue of Next's root layout.
 * Owns only cross-cutting concerns: toasts and i18n. The theme is applied to the document via the
 * `.dark` class from the settings store (see settings/theme.ts), so no theme provider is needed here.
 */
export function RootProviders({
  children,
  locale,
}: React.PropsWithChildren<{ locale?: Locale }>): ReactNode {
  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <AppI18nProvider locale={locale}>{children}</AppI18nProvider>
      </AnchoredToastProvider>
    </ToastProvider>
  );
}
