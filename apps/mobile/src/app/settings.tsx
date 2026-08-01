import { SettingsScreen } from '@mobile/components/settings/settings-screen';

/** Root mount: reachable by deep link and with no host registered at all. */
export default function SettingsRoute(): React.ReactNode {
  return <SettingsScreen />;
}
