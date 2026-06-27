import { AppShell, TopBar } from '@linkcode/ui';
import type { WorkbenchShellProps } from '@linkcode/workbench';
import type { ReactNode } from 'react';

export function WebWorkbenchShell({ header, ...props }: WorkbenchShellProps): ReactNode {
  return <AppShell {...props} header={<TopBar {...header} />} />;
}
