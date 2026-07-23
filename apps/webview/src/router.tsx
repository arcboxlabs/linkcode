import { AutomationsRoute } from '@webview/routes/automations';
import { RootLayout } from '@webview/routes/root-layout';
import { AgentsSettings } from '@webview/routes/settings/agents';
import { AppearanceSettings } from '@webview/routes/settings/appearance';
import { DeveloperSettings } from '@webview/routes/settings/developer';
import { GeneralSettings } from '@webview/routes/settings/general';
import { MessagingSettings } from '@webview/routes/settings/messaging';
import { NotificationsSettings } from '@webview/routes/settings/notifications';
import { PluginsSettings } from '@webview/routes/settings/plugins';
import { ProvidersSettings } from '@webview/routes/settings/providers';
import { SettingsLayout } from '@webview/routes/settings/settings-layout';
import { TerminalSettings } from '@webview/routes/settings/terminal';
import { WorkbenchRoute } from '@webview/routes/workbench-route';
import { createBrowserRouter } from 'react-router';

/** Created after Sentry.init so the data router can register its initial route transaction. */
export function createWebviewRouter(
  createRouter: typeof createBrowserRouter = createBrowserRouter,
): ReturnType<typeof createBrowserRouter> {
  return createRouter([
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
            { path: 'terminal', element: <TerminalSettings /> },
            { path: 'developer', element: <DeveloperSettings /> },
            { path: 'notifications', element: <NotificationsSettings /> },
            { path: 'providers', element: <ProvidersSettings /> },
            { path: 'plugins', element: <PluginsSettings /> },
            { path: 'agents', element: <AgentsSettings /> },
            { path: 'messaging', element: <MessagingSettings /> },
          ],
        },
      ],
    },
  ]);
}
