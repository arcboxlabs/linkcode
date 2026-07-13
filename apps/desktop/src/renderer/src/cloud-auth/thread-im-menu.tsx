import type { SessionInfo } from '@linkcode/schema';
import { RuntimeThreadImMenu } from '@linkcode/workbench';
import { openDesktopSettings } from '../settings/store';

/** Desktop adapter for the thread row's IM menu: the not-linked hand-off opens Settings → IM. */
export function DesktopThreadImMenu({ session }: { session: SessionInfo }): React.ReactNode {
  return (
    <RuntimeThreadImMenu
      session={session}
      onOpenSettings={() => openDesktopSettings('imChannel')}
    />
  );
}
