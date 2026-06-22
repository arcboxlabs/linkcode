import type { ReactElement } from 'react';
import { BrowserRouter } from 'react-router';
import { RootProviders } from '@/providers/RootProviders';
import { AppRoutes } from '@/routes';

export function App(): ReactElement {
  return (
    <RootProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </RootProviders>
  );
}
