import { startWorkspaceScript, stopWorkspaceScript } from '@linkcode/sdk';
import { OpenUrlChoiceDialog, ServicesMenu } from '@linkcode/ui/shell/scripts';
import { toastManager } from 'coss-ui/components/toast';
import { noop } from 'foxact/noop';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { useState } from 'react';
import { useMutation } from '../runtime/tayori';
import { useWorkspaceScripts } from './hooks';
import { useOpenUrlPreferenceStore } from './open-url-store';

export interface WorkspaceServicesMenuProps {
  cwd: string | undefined;
  /** Open a URL in the host's in-app browser pane. Absent (webview) → always external. */
  onOpenInApp?: (url: string) => void;
  /** Jump to a script's log terminal. Absent hides the View action. */
  onViewLogs?: (terminalId: string) => void;
}

/**
 * The workspace services chip: declared scripts with run/stop/view/preview-link actions. Preview
 * links follow the persisted open-URL preference; hosts without an in-app browser always open
 * externally (`window.open`, routed to the system browser by the desktop main process).
 */
export function WorkspaceServicesMenu({
  cwd,
  onOpenInApp,
  onViewLogs,
}: WorkspaceServicesMenuProps): React.ReactNode {
  const { data: scripts } = useWorkspaceScripts(cwd);
  const onError = (error: unknown): void => {
    toastManager.add({ title: extractErrorMessage(error), type: 'error' });
  };
  const startMutation = useMutation(startWorkspaceScript, { onError });
  const stopMutation = useMutation(stopWorkspaceScript, { onError });
  const behavior = useOpenUrlPreferenceStore((state) => state.behavior);
  const setBehavior = useOpenUrlPreferenceStore((state) => state.setBehavior);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);

  if (cwd === undefined || !scripts || scripts.length === 0) return null;

  function openExternal(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function openUrl(url: string): void {
    if (!onOpenInApp || behavior === 'external') {
      openExternal(url);
    } else if (behavior === 'in-app') {
      onOpenInApp(url);
    } else {
      setPendingUrl(url);
    }
  }

  function choose(choice: 'in-app' | 'external', remember: boolean): void {
    const url = pendingUrl;
    setPendingUrl(null);
    if (remember) setBehavior(choice);
    if (url === null) return;
    if (choice === 'in-app' && onOpenInApp) onOpenInApp(url);
    else openExternal(url);
  }

  return (
    <>
      <ServicesMenu
        scripts={scripts}
        onRun={(scriptName) => {
          startMutation.trigger({ cwd, scriptName }).catch(noop);
        }}
        onStop={(scriptName) => {
          stopMutation.trigger({ cwd, scriptName }).catch(noop);
        }}
        onViewLogs={onViewLogs}
        onOpenUrl={openUrl}
      />
      <OpenUrlChoiceDialog
        url={pendingUrl}
        onOpenChange={(open) => {
          if (!open) setPendingUrl(null);
        }}
        onChoose={choose}
      />
    </>
  );
}
