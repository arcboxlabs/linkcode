import { AnchoredToastProvider, ToastProvider } from 'coss-ui/components/toast';
import type { ReactElement, ReactNode } from 'react';
import { AppI18nProvider } from '@/providers/AppI18nProvider';

/**
 * Global, route-agnostic providers — the SPA analogue of Next's root layout.
 * Owns only cross-cutting concerns: toasts and i18n. The theme is dark-locked at
 * the document level (see index.html / index.css); swap in a theme provider here
 * if light mode is ever introduced. Data fetching, connection, and the dashboard
 * shell live in the connected route group, not here.
 */
export function RootProviders({ children }: { children: ReactNode }): ReactElement {
  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <AppI18nProvider>{children}</AppI18nProvider>
      </AnchoredToastProvider>
    </ToastProvider>
  );
}
