import type { SessionInfo } from '@linkcode/schema';
import { RuntimeThreadImMenu } from '@linkcode/workbench';
import { openDesktopSettings } from '../settings/store';
import { useCloudAccount } from './use-cloud-account';

/** Desktop adapter for the thread row's IM menu: the not-linked hand-off opens Settings → IM. */
export function DesktopThreadImMenu({ session }: { session: SessionInfo }): React.ReactNode {
  const cloudAuth = useCloudAccount();
  return (
    <RuntimeThreadImMenu
      session={session}
      accountKey={cloudAuth.account?.email ?? null}
      onOpenSettings={() => openDesktopSettings('imChannel')}
    />
  );
}
