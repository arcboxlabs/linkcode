import { Button } from 'coss-ui/components/button';
import { Card } from 'coss-ui/components/card';
import { useRef } from 'react';
import { cn } from '../../lib/cn';
import { FileIdentityIcon } from '../file-identity-icon';
import { FilePathTooltip } from '../with-tooltip';
import { useArtifactHostActions } from './context';
import { fileBasename } from './file-kind';

/** Compact produced-file artifact; opens the host file viewer when available. */
export function FileArtifactCard({
  path,
  className,
}: {
  /** Workspace-relative or absolute path as the agent reported it. */
  path: string;
  className?: string;
}): React.ReactNode {
  const tooltipAnchorRef = useRef<HTMLSpanElement>(null);
  const actions = useArtifactHostActions();
  const openFile = actions?.openFile;

  const body = (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground [&_svg]:size-4">
        <FileIdentityIcon className="size-4" path={path} ref={tooltipAnchorRef} />
      </span>
      <span className="min-w-0 flex-1 truncate text-left font-medium text-[13px] text-foreground">
        {fileBasename(path)}
      </span>
    </>
  );

  const frame = 'my-1 w-full max-w-md overflow-hidden';

  if (!openFile) {
    return (
      <FilePathTooltip anchor={tooltipAnchorRef} tooltip={path}>
        <Card
          className={cn(
            frame,
            'flex-row items-center gap-2.5 px-2.5 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            className,
          )}
          tabIndex={0}
        >
          {body}
        </Card>
      </FilePathTooltip>
    );
  }

  return (
    <Card className={cn(frame, className)}>
      <FilePathTooltip anchor={tooltipAnchorRef} tooltip={path}>
        <Button
          className="h-auto w-full justify-start rounded-2xl border-0 px-2.5 py-2 font-normal focus-visible:ring-inset"
          variant="ghost"
          onClick={() => openFile(path)}
        >
          {body}
        </Button>
      </FilePathTooltip>
    </Card>
  );
}
