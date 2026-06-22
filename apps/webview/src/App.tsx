import type { ReactElement } from 'react';
import { RouterProvider } from 'react-router';
import { RootProviders } from '@/providers/RootProviders';
import { appRouter } from '@/routes';

export function App(): ReactElement {
  return (
    <RootProviders>
      <RouterProvider router={appRouter} />
    </RootProviders>
  );
}
