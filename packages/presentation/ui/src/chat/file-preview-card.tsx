import { Badge } from 'coss-ui/components/badge';
import { Button } from 'coss-ui/components/button';
import { Card, CardHeader, CardPanel, CardTitle } from 'coss-ui/components/card';
import { useRef } from 'react';
import { cn } from '../lib/cn';
import { fileBasename } from './artifacts/file-kind';
import type { ArtifactNavigation } from './artifacts/host-actions';
import { artifactNavigationAction, useArtifactHostActions } from './artifacts/host-actions';
import { FileIdentityIcon } from './file-identity-icon';
import { FilePathTooltip } from './with-tooltip';

/** Shared file-result surface: basename in chrome, full path in a coss tooltip, and host navigation. */
export function FilePreviewCard({
  badge,
  children,
  className,
  headerEnd,
  label,
  navigation,
  panelClassName,
  path,
  tooltip,
}: {
  badge?: string;
  children?: React.ReactNode;
  className?: string;
  headerEnd?: React.ReactNode;
  label?: string;
  navigation?: ArtifactNavigation | null;
  panelClassName?: string;
  path: string;
  tooltip?: string;
}): React.ReactNode {
  const tooltipAnchorRef = useRef<HTMLSpanElement>(null);
  const actions = useArtifactHostActions();
  const target = navigation === undefined ? { kind: 'file' as const, path } : navigation;
  const onOpen = artifactNavigationAction(actions, target);
  const fullPath = tooltip ?? path;
  const content = (
    <>
      <FileIdentityIcon className="shrink-0" path={path} ref={tooltipAnchorRef} />
      <CardTitle
        className="min-w-0 flex-1 truncate text-left font-mono font-normal text-xs leading-normal"
        render={<span />}
      >
        {label ?? fileBasename(path)}
      </CardTitle>
      {badge ? (
        <Badge size="sm" variant="secondary">
          {badge}
        </Badge>
      ) : null}
      {headerEnd}
    </>
  );
  const header = onOpen ? (
    <Button
      className="w-full justify-start rounded-none border-0 px-3 py-1.5 font-normal text-muted-foreground text-xs focus-visible:ring-inset sm:text-xs"
      size="sm"
      variant="ghost"
      onClick={onOpen}
    >
      {content}
    </Button>
  ) : (
    <div
      className="flex items-center gap-2 px-3 py-1.5 text-muted-foreground text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      tabIndex={0}
    >
      {content}
    </div>
  );

  return (
    <Card className={cn('my-1 overflow-hidden', className)}>
      <CardHeader
        className={cn(
          'grid-cols-1 grid-rows-[auto] bg-muted p-0 in-[[data-slot=card]:has(>[data-slot=card-panel])]:pb-0',
          children !== undefined && 'border-b',
        )}
      >
        <FilePathTooltip anchor={tooltipAnchorRef} tooltip={fullPath}>
          {header}
        </FilePathTooltip>
      </CardHeader>
      {children === undefined ? null : (
        <CardPanel className={cn('px-3 py-2', panelClassName)}>{children}</CardPanel>
      )}
    </Card>
  );
}
