import { AppI18nProvider } from '@webview/providers/app-i18n-provider';
import { AnchoredToastProvider, ToastProvider } from 'coss-ui/components/toast';
import type * as React from 'react';

/**
 * Global, route-agnostic providers — the SPA analogue of Next's root layout.
 * Owns only cross-cutting concerns: toasts and i18n. The theme is dark-locked at
 * the document level (see index.html / index.css); swap in a theme provider here
 * if light mode is ever introduced.
 */
export function RootProviders({ children }: React.PropsWithChildren): React.ReactNode {
  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <AppI18nProvider>{children}</AppI18nProvider>
      </AnchoredToastProvider>
    </ToastProvider>
  );
}
