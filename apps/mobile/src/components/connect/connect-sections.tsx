import { DiscoveredHostsSection } from '@mobile/components/connect/discovered-hosts-section';
import { MyMachinesSection } from '@mobile/components/connect/my-machines-section';
import { SavedHostsSection } from '@mobile/components/connect/saved-hosts-section';
import { SignInSection } from '@mobile/components/connect/sign-in-section';
import { useCloudAccount } from '@mobile/runtime/cloud/account';
import { useHostRegistryStore } from '@mobile/stores/host-store';

/** The connect screen's section stack, single-sourced: each section resolves to its platform
 * implementation through the Metro extension seam, so only the scaffold around this differs. */
export function ConnectSections(): React.ReactNode {
  const account = useCloudAccount();
  const hosts = useHostRegistryStore((state) => state.hosts);

  return (
    <>
      {account.status === 'signed-in' ? (
        <MyMachinesSection userId={account.user.id} />
      ) : account.status === 'signed-out' ? (
        <SignInSection />
      ) : null}

      {hosts.length > 0 ? <SavedHostsSection /> : null}

      <DiscoveredHostsSection />
    </>
  );
}
