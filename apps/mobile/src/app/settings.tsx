import { SettingsScreen } from '@mobile/components/settings/settings-screen';

/** Pushed from the tab screens' overflow menu; ungated so "Manage hosts" stays reachable when
 * the selected host is not. */
export default function SettingsRoute(): React.ReactNode {
  return <SettingsScreen />;
}
