import { ShellIconButton } from '@linkcode/ui';
import { systemBridge } from '@renderer/ipc';
import { useEffect as useAbortableEffect } from 'foxact/use-abortable-effect';
import { CopyIcon, MinusIcon, SquareIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import type { DesktopChromeMetricsStyle } from './metrics';
import { DESKTOP_CHROME_METRICS_STYLE } from './metrics';

// The layer mounts at the app root, outside any `.linkcode-desktop-shell`, so it carries the chrome
// CSS vars itself (height / edge padding / control gap) for its own sizing.
const WINDOW_CONTROLS_LAYER_STYLE: DesktopChromeMetricsStyle = DESKTOP_CHROME_METRICS_STYLE;

/**
 * Persistent minimize / maximize-restore / close controls for platforms without native traffic
 * lights (Windows, Linux). `titleBarStyle: 'hidden'` strips the OS caption buttons there, so the
 * renderer draws them. Mounted at the app root ABOVE the connection gate and the settings overlay,
 * so they stay reachable while the daemon is connecting/unreachable and never shift as the app moves
 * between the connection fallback, the shell, and settings. macOS keeps its native traffic lights;
 * the preload-backed platform constant prevents renderer heuristics and macOS control flashes.
 */
export function DesktopWindowControls(): React.ReactNode {
  if (systemBridge.app.platform === 'darwin') return null;

  return (
    <div
      className="pointer-events-none fixed top-0 right-0 z-[60] flex h-(--lc-chrome-h) items-center px-(--lc-chrome-edge)"
      style={WINDOW_CONTROLS_LAYER_STYLE}
    >
      <WindowControls />
    </div>
  );
}

/**
 * The button row; positioned by {@link DesktopWindowControls}. Drives the already-wired
 * `systemBridge.window` IPC; maximize state comes from the main-pushed `onMaximizedChange`.
 */
function WindowControls(): React.ReactNode {
  const [maximized, setMaximized] = useState(false);
  useAbortableEffect((signal) => {
    void systemBridge.window.isMaximized().then((value) => {
      if (!signal.aborted) setMaximized(value);
    });
    signal.addEventListener('abort', systemBridge.window.onMaximizedChange(setMaximized));
  }, []);

  return (
    <div className="pointer-events-auto flex h-full items-center gap-(--lc-chrome-control-gap)">
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
