import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { PlaceholderPage } from '@/features/placeholder/PlaceholderPage';
import { WorkbenchPage } from '@/features/workbench/WorkbenchPage';
import { ConnectedLayout } from '@/layouts/connected-layout';

/**
 * Route tree. The single connected route group (`ConnectedLayout`) gates every
 * page on the host connection and provides the dashboard shell. Feature pages
 * are mounted as `<Outlet />` children — mirroring the dashboard's
 * `(protected)/feature/page` layout, adapted to React Router's element routes.
 */
export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route element={<ConnectedLayout />}>
        <Route index element={<WorkbenchPage />} />
        <Route
          path="history"
          element={<PlaceholderPage title="History" description="Past sessions and transcripts will live here." />}
        />
        <Route
          path="settings"
          element={<PlaceholderPage title="Settings" description="Workbench and agent settings will live here." />}
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
