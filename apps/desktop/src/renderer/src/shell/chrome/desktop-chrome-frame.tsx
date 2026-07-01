import { cn, ShellFrame } from '@linkcode/ui';
import type { AllotmentHandle } from 'allotment';
import { Allotment, LayoutPriority } from 'allotment';
import type { CSSProperties, ReactNode, Ref } from 'react';
import type { DesktopChromeProps } from './chrome';
import { DesktopChrome } from './chrome';
import type { DesktopChromeMetricsStyle } from './metrics';

export type DesktopChromeFrameStyle = CSSProperties &
  DesktopChromeMetricsStyle & {
    '--lc-sidebar-w': string;
    '--lc-right-w': string;
    '--lc-bottom-h': string;
  };

export interface DesktopSidebarSplitProps {
  defaultSizes: [number, number];
  mainMinSize: number;
  maxSize: number;
  minSize: number;
  preferredSize: number;
  visible: boolean;
  setAllotmentHandle: (handle: AllotmentHandle | null) => void;
  onChange: (sizes: number[]) => void;
  onDragEnd: (sizes: number[]) => void;
  onReset: () => void;
}

export interface DesktopChromeFrameProps {
  chrome: Omit<DesktopChromeProps, 'children'>;
  main: ReactNode;
  sidebar: ReactNode;
  className?: string;
  rootRef?: Ref<HTMLDivElement>;
  sidebarSplit?: DesktopSidebarSplitProps;
  style: DesktopChromeFrameStyle;
}

export function DesktopChromeFrame({
  chrome,
  main,
  sidebar,
  className,
  rootRef,
  sidebarSplit,
  style,
}: DesktopChromeFrameProps): ReactNode {
  return (
    <div
      ref={rootRef}
      className={cn(
        'linkcode-desktop-shell relative h-full bg-transparent text-foreground',
        className,
      )}
      style={style}
    >
      <DesktopChrome {...chrome}>{renderChromeBody({ main, sidebar, sidebarSplit })}</DesktopChrome>
    </div>
  );
}

function renderChromeBody({
  main,
  sidebar,
  sidebarSplit,
}: {
  main: ReactNode;
  sidebar: ReactNode;
  sidebarSplit?: DesktopSidebarSplitProps;
}): ReactNode {
  if (!sidebarSplit) {
    // Settings reuses desktop chrome without the workbench's resizable sidebar split.
    return (
      <ShellFrame
        className="bg-transparent"
        sidebar={sidebar}
        sidebarClassName="w-(--lc-sidebar-w)"
      >
        {main}
      </ShellFrame>
    );
  }

  return (
    <Allotment
      ref={sidebarSplit.setAllotmentHandle}
      className="linkcode-shell-split linkcode-shell-sidebar-main-split h-full"
      defaultSizes={sidebarSplit.defaultSizes}
      proportionalLayout={false}
      separator={false}
      onChange={sidebarSplit.onChange}
      onDragEnd={sidebarSplit.onDragEnd}
      onReset={sidebarSplit.onReset}
    >
      <Allotment.Pane
        maxSize={sidebarSplit.maxSize}
        minSize={sidebarSplit.minSize}
        preferredSize={sidebarSplit.preferredSize}
        visible={sidebarSplit.visible}
      >
        {sidebar}
      </Allotment.Pane>
      <Allotment.Pane minSize={sidebarSplit.mainMinSize} priority={LayoutPriority.High}>
        {main}
      </Allotment.Pane>
    </Allotment>
  );
}
