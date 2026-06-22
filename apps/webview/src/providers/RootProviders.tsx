import type { ReactElement, ReactNode } from 'react';
import { AppI18nProvider } from '@/providers/AppI18nProvider';

export function RootProviders({ children }: { children: ReactNode }): ReactElement {
  return <AppI18nProvider>{children}</AppI18nProvider>;
}
