import { AutomationsRoute } from '@webview/routes/automations';
import { RootLayout } from '@webview/routes/root-layout';
import { AgentsSettings } from '@webview/routes/settings/agents';
import { AppearanceSettings } from '@webview/routes/settings/appearance';
import { ConnectionSettings } from '@webview/routes/settings/connection';
import { GeneralSettings } from '@webview/routes/settings/general';
import { MessagingSettings } from '@webview/routes/settings/messaging';
import { NotificationsSettings } from '@webview/routes/settings/notifications';
import { ProvidersSettings } from '@webview/routes/settings/providers';
import { SettingsLayout } from '@webview/routes/settings/settings-layout';
import { WorkbenchRoute } from '@webview/routes/workbench-route';
import { createBrowserRouter } from 'react-router';

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <WorkbenchRoute /> },
      { path: 'automations', element: <AutomationsRoute /> },
      {
        path: 'settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <GeneralSettings /> },
          { path: 'appearance', element: <AppearanceSettings /> },
          { path: 'connection', element: <ConnectionSettings /> },
          { path: 'notifications', element: <NotificationsSettings /> },
          { path: 'providers', element: <ProvidersSettings /> },
          { path: 'agents', element: <AgentsSettings /> },
          { path: 'messaging', element: <MessagingSettings /> },
        ],
      },
    ],
  },
]);
