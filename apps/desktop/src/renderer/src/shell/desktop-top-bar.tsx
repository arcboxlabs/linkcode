import type { SystemBridge } from '@linkcode/ipc';
import { TopBar } from '@linkcode/ui';
import type { TopBarProps } from '@linkcode/ui';
import { noop } from 'foxact/noop';
import { useEffect } from 'foxact/use-abortable-effect';
import { Minimize2Icon, MinusIcon, SquareIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

type WindowControlsMode = 'native-macos' | 'custom';
type WindowBridge = SystemBridge['window'];

export interface DesktopTopBarProps extends Pick<TopBarProps, 'title' | 'subtitle' | 'usage'> {
  systemBridge: SystemBridge;
}

export function DesktopTopBar({
  title,
  subtitle,
  usage,
  systemBridge,
}: DesktopTopBarProps): ReactNode {
  const win = systemBridge.window;
  const [windowControlsMode, setWindowControlsMode] = useState<WindowControlsMode>('custom');
  const [maximizedSnapshot, setMaximizedSnapshot] = useState<{
    window: WindowBridge;
    value: boolean;
  } | null>(null);
  const isMaximized = maximizedSnapshot?.window === win ? maximizedSnapshot.value : false;

  useEffect(
    (signal) => {
      systemBridge.app
        .platform()
        .then((value) => {
          if (!signal.aborted) {
            setWindowControlsMode(value === 'darwin' ? 'native-macos' : 'custom');
          }
        })
        .catch(() => {
          if (!signal.aborted) setWindowControlsMode('custom');
        });
    },
    [systemBridge],
  );

  useEffect(
    (signal) => {
      let receivedMaximizedEvent = false;
      const unsubscribe = win.onMaximizedChange?.((value) => {
        receivedMaximizedEvent = true;
        setMaximizedSnapshot({ window: win, value });
      });

      void win
        .isMaximized()
        .then((value) => {
          if (!signal.aborted && !receivedMaximizedEvent) {
            setMaximizedSnapshot({ window: win, value });
          }
        })
        .catch(() => {
          if (!signal.aborted && !receivedMaximizedEvent) {
            setMaximizedSnapshot({ window: win, value: false });
          }
        });

      return unsubscribe;
    },
    [win],
  );

  async function handleToggleMaximize(): Promise<void> {
    await win.toggleMaximize();
    const next = await win.isMaximized();
    setMaximizedSnapshot({ window: win, value: next });
  }

  return (
    <TopBar
      title={title}
      subtitle={subtitle}
      usage={usage}
      className={
        windowControlsMode === 'native-macos'
          ? 'pl-20 [-webkit-app-region:drag]'
          : '[-webkit-app-region:drag]'
      }
      trailing={
        windowControlsMode === 'custom' ? (
          <div className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
            <button
              type="button"
              aria-label="Minimize"
              onClick={() => {
                void win.minimize();
              }}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <MinusIcon className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={isMaximized ? 'Restore' : 'Maximize'}
              aria-pressed={isMaximized}
              onClick={() => {
                void handleToggleMaximize().catch(noop);
              }}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {isMaximized ? (
                <Minimize2Icon className="size-3.5" />
              ) : (
                <SquareIcon className="size-3" />
              )}
            </button>
            <button
              type="button"
              aria-label="Close"
              onClick={() => {
                void win.close();
              }}
              className="rounded p-1 text-muted-foreground hover:bg-destructive hover:text-white"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ) : null
      }
    />
  );
}
