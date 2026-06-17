import type { ReactElement } from 'react';
import { BrowserRouter } from 'react-router';
import { AppI18nProvider } from './i18n/AppI18nProvider';
import { AppRoutes } from './routes';

export function App(): ReactElement {
  return (
    <AppI18nProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppI18nProvider>
  );
}
