import type { PresentSessionNotification } from '@linkcode/workbench';
import { useSessionSelectionStore } from '@linkcode/workbench';

/**
 * Browser presenter: the Web Notification API. Without a granted permission it silently no-ops —
 * the settings pane owns requesting permission and explaining a denial. `tag` collapses repeats
 * from the same session into one notification.
 */
export const presentWebNotification: PresentSessionNotification = ({ sessionId, title, body }) => {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const notification = new Notification(title, { body, tag: sessionId });
  notification.addEventListener('click', () => {
    window.focus();
    useSessionSelectionStore.getState().setSelectedId(sessionId);
    notification.close();
  });
};
