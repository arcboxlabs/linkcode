import { Redirect } from 'expo-router';
import { Spinner } from 'heroui-native';
import { View } from 'react-native';
import { BrandMark } from '../components/brand-mark';
import { useCloudAccount } from '../runtime/cloud/account';
import { resolveStartupTarget } from '../runtime/startup';
import { useHostRegistryHydrated, useHostRegistryStore } from '../stores/host-store';

/**
 * Startup router: waits for the persisted registry and the account state,
 * then lands on the last active host, the machine list, or first-run sign-in.
 */
export default function StartupScreen() {
  const hydrated = useHostRegistryHydrated();
  const account = useCloudAccount();
  const hosts = useHostRegistryStore((state) => state.hosts);
  const lastActiveHostId = useHostRegistryStore((state) => state.lastActiveHostId);

  // Only first-run routing waits on account state — LAN/direct users with
  // saved hosts must not block on a slow or offline cloud session check.
  if (!hydrated || (hosts.length === 0 && account.status === 'loading')) {
    return (
      <View className="flex-1 items-center justify-center gap-6 bg-background">
        <BrandMark />
        <Spinner />
      </View>
    );
  }

  const target = resolveStartupTarget({
    hosts,
    lastActiveHostId,
    signedIn: account.status === 'signed-in',
  });
  if (target.kind === 'sign-in') return <Redirect href="/sign-in" />;
  if (target.kind === 'connect') return <Redirect href="/connect" />;
  return <Redirect href={`/host/${target.hostId}`} />;
}
