import { createBrowserRouter, Navigate } from 'react-router';
import { PlaceholderPage } from '@/features/placeholder/PlaceholderPage';
import { WorkbenchPage } from '@/features/workbench/WorkbenchPage';
import { ConnectedLayout } from '@/layouts/connected-layout';

/**
 * Route tree. The connected route group gates every page on the host connection
 * and provides the dashboard shell. Feature pages are mounted as `<Outlet />`
 * children — mirroring the dashboard's `(protected)/feature/page` layout on
 * React Router's data-router API.
 */
export const appRouter = createBrowserRouter([
  {
    path: '/',
    element: <ConnectedLayout />,
    children: [
      { index: true, element: <WorkbenchPage /> },
      {
        path: 'history',
        element: (
          <PlaceholderPage
            title="History"
            description="Past sessions and transcripts will live here."
          />
        ),
      },
      {
        path: 'settings',
        element: (
          <PlaceholderPage
            title="Settings"
            description="Workbench and agent settings will live here."
          />
        ),
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
