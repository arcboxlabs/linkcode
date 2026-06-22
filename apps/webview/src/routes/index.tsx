import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { WorkbenchPage } from '@/features/workbench/WorkbenchPage';
import { WorkbenchLayout } from '@/layouts/WorkbenchLayout';

export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route element={<WorkbenchLayout />}>
        <Route index element={<WorkbenchPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
