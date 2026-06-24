import type { ReactNode } from 'react';
import { RouterProvider } from 'react-router';
import { RootProviders } from '@/providers/root-providers';
import { appRouter } from '@/routes';

export function App(): ReactNode {
  return (
    <RootProviders>
      <RouterProvider router={appRouter} />
    </RootProviders>
  );
}
