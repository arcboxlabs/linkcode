import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { WorkbenchPage } from './workbench/WorkbenchPage';

export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route index element={<WorkbenchPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
