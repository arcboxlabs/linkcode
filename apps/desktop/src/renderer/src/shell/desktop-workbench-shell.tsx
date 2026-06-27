import { AppShell } from '@linkcode/ui';
import type { WorkbenchShellProps } from '@linkcode/workbench';
import type { ReactNode } from 'react';
import { systemBridge } from '@/ipc';
import { DesktopTopBar } from './desktop-top-bar';

export function DesktopWorkbenchShell({ header, ...props }: WorkbenchShellProps): ReactNode {
  return <AppShell {...props} header={<DesktopTopBar {...header} systemBridge={systemBridge} />} />;
}
