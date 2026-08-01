import { SettingsScreen } from '@mobile/components/settings/settings-screen';

/** Tab mount: ungated, so a host that cannot be reached still leaves "Manage hosts" in reach. */
export default function SettingsTabRoute(): React.ReactNode {
  return <SettingsScreen />;
}
