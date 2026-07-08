import { ShellIconButton } from '@linkcode/ui';
import { systemBridge } from '@renderer/ipc';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from 'lucide-react';
import { useState } from 'react';

/**
 * Minimize / maximize-restore / close buttons for platforms without native traffic lights
 * (Windows, Linux). `titleBarStyle: 'hidden'` strips the OS caption buttons there, so the renderer
 * draws them and drives the already-wired `systemBridge.window` IPC; macOS keeps its native traffic
 * lights and never renders these. Maximize state comes from the main-pushed `onMaximizedChange`.
 */
export function WindowControls(): React.ReactNode {
  const [maximized, setMaximized] = useState(false);
  useAbortableEffect((signal) => {
    void systemBridge.window.isMaximized().then((value) => {
      if (!signal.aborted) setMaximized(value);
    });
    signal.addEventListener('abort', systemBridge.window.onMaximizedChange(setMaximized));
  }, []);

  return (
    <div className="pointer-events-auto ms-1 flex h-full items-center gap-(--lc-chrome-control-gap)">
      <ShellIconButton
        label="Minimize"
        onClick={() => {
          void systemBridge.window.minimize();
        }}
      >
        <MinusIcon className="size-4" />
      </ShellIconButton>
      <ShellIconButton
        label={maximized ? 'Restore' : 'Maximize'}
        onClick={() => {
          void systemBridge.window.toggleMaximize();
        }}
      >
        {maximized ? <CopyIcon className="size-4" /> : <SquareIcon className="size-4" />}
      </ShellIconButton>
      <ShellIconButton
        label="Close"
        className="hover:bg-destructive hover:text-white"
        onClick={() => {
          void systemBridge.window.close();
        }}
      >
        <XIcon className="size-4" />
      </ShellIconButton>
    </div>
  );
}
