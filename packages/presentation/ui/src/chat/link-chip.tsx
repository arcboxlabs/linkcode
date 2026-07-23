import { Badge } from 'coss-ui/components/badge';
import { cn } from '../lib/cn';
import { artifactNavigationAction, useArtifactHostActions } from './artifacts/host-actions';
import { Favicon, LinkTargetIcon } from './link-icon';
import type { LinkTarget } from './link-target';

/** Match the chat prose's 14px metrics; the badge's own sm scale is tuned for bare counters. */
const LINK_CHIP_CLASS = 'mx-0.5 h-5 max-w-full align-bottom text-sm sm:h-5 sm:text-sm';

function chipTitle(target: Exclude<LinkTarget, { kind: 'web' }>): string {
  switch (target.kind) {
    case 'plugin': {
      return target.id;
    }
    case 'skill':
    case 'file': {
      return target.path;
    }
    case 'uri': {
      return target.uri;
    }
    default: {
      return target satisfies never;
    }
  }
}

export interface LinkChipProps {
  target: LinkTarget;
  children: React.ReactNode;
  className?: string;
}

/** Inline reference chip for a classified link target — the one body every inline file,
 * skill, plugin, and resource reference renders through. Web targets link out with a
 * favicon; file and skill targets open through the artifact host actions when the host
 * wires them; plugin and unknown-scheme targets stay inert with the raw target as tooltip. */
export function LinkChip({ target, children, className }: LinkChipProps): React.ReactNode {
  const actions = useArtifactHostActions();

  if (target.kind === 'web') {
    return (
      <Badge
        size="sm"
        variant="secondary"
        className={cn(LINK_CHIP_CLASS, className)}
        render={<a href={target.href} rel="noreferrer" target="_blank" />}
      >
        <Favicon hostname={target.hostname} />
        <span className="truncate">{children}</span>
      </Badge>
    );
  }

  const onOpen =
    target.kind === 'file' || target.kind === 'skill'
      ? artifactNavigationAction(actions, { kind: 'file', path: target.path })
      : undefined;
  return (
    <Badge
      size="sm"
      variant="secondary"
      className={cn(LINK_CHIP_CLASS, className)}
      title={chipTitle(target)}
      render={onOpen ? <button type="button" onClick={onOpen} /> : <span />}
    >
      <LinkTargetIcon target={target} />
      <span className="truncate">{children}</span>
    </Badge>
  );
}
