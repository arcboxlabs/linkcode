import { Badge } from 'coss-ui/components/badge';
import { Frame } from 'coss-ui/components/frame';
import { useRef } from 'react';
import { cn } from '../lib/cn';
import { fileBasename } from './artifacts/file-kind';
import type { ArtifactNavigation } from './artifacts/host-actions';
import { artifactNavigationAction, useArtifactHostActions } from './artifacts/host-actions';
import { ChatCardActions, ChatCardHeader, ChatCardPanel, ChatCardTitle } from './chat-card';
import { FileIdentityIcon } from './file-identity-icon';
import { FilePathTooltip } from './with-tooltip';

/** Shared file-result surface: basename in the frame header, full path in a coss tooltip,
 * and host navigation on the header row. */
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
      <ChatCardTitle className="text-left">{label ?? fileBasename(path)}</ChatCardTitle>
      {badge || headerEnd ? (
        <ChatCardActions>
          {badge ? (
            <Badge size="sm" variant="secondary">
              {badge}
            </Badge>
          ) : null}
          {headerEnd}
        </ChatCardActions>
      ) : null}
    </>
  );
  const header = onOpen ? (
    <ChatCardHeader className="p-0">
      <button
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-1.5 text-left outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        type="button"
        onClick={onOpen}
      >
        {content}
      </button>
    </ChatCardHeader>
  ) : (
    <ChatCardHeader
      className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      tabIndex={0}
    >
      {content}
    </ChatCardHeader>
  );

  return (
    <Frame className={cn('my-1', className)}>
      <FilePathTooltip anchor={tooltipAnchorRef} tooltip={fullPath}>
        {header}
      </FilePathTooltip>
      {children === undefined ? null : (
        <ChatCardPanel className={panelClassName}>{children}</ChatCardPanel>
      )}
    </Frame>
  );
}
