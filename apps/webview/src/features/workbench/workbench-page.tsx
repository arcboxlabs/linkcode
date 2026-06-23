import { Workbench } from '@linkcode/workbench';
import type { ReactNode } from 'react';
import { BreadcrumbCurrent } from '@/components/breadcrumbs';
import { usePageTitle } from '@/hooks/use-page-title';

/**
 * The workbench feature page. The data plane + connection gate are owned by
 * `ConnectedLayout`, so this page just declares its title/breadcrumb (static,
 * renders immediately) and mounts the workbench surface, which fills the inset.
 */
export function WorkbenchPage(): ReactNode {
  usePageTitle('Workbench');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BreadcrumbCurrent title="Workbench" />
      <div className="min-h-0 flex-1">
        <Workbench />
      </div>
    </div>
  );
}
