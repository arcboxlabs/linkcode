import { BookTextIcon, FileTextIcon, GlobeIcon, PuzzleIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { FileIdentityIcon } from './file-identity-icon';
import type { LinkTarget } from './link-target';
import { linkTargetFor } from './link-target';

const LINK_ICON_CLASS = 'inline-block size-3.5 shrink-0 align-text-bottom';

export interface LinkTargetIconProps {
  target: LinkTarget;
  className?: string;
}

/** The icon for a classified link target: a local globe for the web, file-identity icons for
 * workspace files, and glyphs for skill and plugin mentions. */
export function LinkTargetIcon({ target, className }: LinkTargetIconProps): React.ReactNode {
  switch (target.kind) {
    case 'web': {
      return <GlobeIcon aria-hidden className={cn(LINK_ICON_CLASS, className)} />;
    }
    case 'file': {
      return <FileIdentityIcon path={target.path} className={cn('align-text-bottom', className)} />;
    }
    case 'skill': {
      return <BookTextIcon aria-hidden className={cn(LINK_ICON_CLASS, className)} />;
    }
    case 'plugin': {
      return <PuzzleIcon aria-hidden className={cn(LINK_ICON_CLASS, className)} />;
    }
    case 'uri': {
      return <FileTextIcon aria-hidden className={cn(LINK_ICON_CLASS, className)} />;
    }
    default: {
      return target satisfies never;
    }
  }
}

export interface UrlLinkIconProps {
  url?: string;
  className?: string;
  /** Rendered when the url is absent or not a web link. */
  fallback?: React.ReactNode;
}

/** Local icon for a web URL, without fetching content from the destination or a third party. */
export function UrlLinkIcon({
  url,
  className,
  fallback = null,
}: UrlLinkIconProps): React.ReactNode {
  const target = url === undefined ? null : linkTargetFor(url);
  if (target?.kind !== 'web') return fallback;
  return <LinkTargetIcon target={target} className={className} />;
}
