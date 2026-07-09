import type { SessionId } from '@linkcode/schema';
import type { PresentSessionNotification } from '@linkcode/workbench';
import { useSessionSelectionStore } from '@linkcode/workbench';
import { systemBridge } from './ipc';

/** Desktop OS presenter: main-process `Notification` via the system bridge. */
export const presentDesktopNotification: PresentSessionNotification = ({
  sessionId,
  title,
  body,
}) => {
  void systemBridge.notifications.notify({ title, body, clickToken: sessionId });
};

/** Click-through: main has already focused the window; select the clicked session. */
export function installNotificationClickThrough(): () => void {
  return systemBridge.notifications.onClick((clickToken) => {
    useSessionSelectionStore.getState().setSelectedId(clickToken as SessionId);
  });
}
