import type { ReactElement } from 'react';
import { Outlet } from 'react-router';

export function WorkbenchLayout(): ReactElement {
  return (
    <div className="h-full min-h-0 bg-background text-foreground">
      <Outlet />
    </div>
  );
}
