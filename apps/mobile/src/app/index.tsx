import { Redirect } from 'expo-router';
import { Spinner } from 'heroui-native';
import { View } from 'react-native';
import { useHostRegistryHydrated, useHostRegistryStore } from '../stores/host-store';

/** Startup router: waits for the persisted registry, then lands on connect or the last active host. */
export default function StartupScreen() {
  const hydrated = useHostRegistryHydrated();
  const hosts = useHostRegistryStore((state) => state.hosts);
  const lastActiveHostId = useHostRegistryStore((state) => state.lastActiveHostId);

  if (!hydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Spinner />
      </View>
    );
  }

  if (hosts.length === 0) return <Redirect href="/connect" />;

  const target = hosts.find((host) => host.id === lastActiveHostId) ?? hosts[0];
  return <Redirect href={`/host/${target.id}`} />;
}
