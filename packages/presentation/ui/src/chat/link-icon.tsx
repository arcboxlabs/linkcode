import { BookTextIcon, FileTextIcon, GlobeIcon, PuzzleIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/cn';
import { FileIdentityIcon } from './file-identity-icon';
import type { LinkTarget } from './link-target';
import { linkTargetFor } from './link-target';

const LINK_ICON_CLASS = 'inline-block size-3.5 shrink-0 align-text-bottom';

interface WebLinkIconProps {
  href: string;
  className?: string;
}

function WebLinkIcon({ href, className }: WebLinkIconProps): React.ReactNode {
  const origin = new URL(href).origin;
  const sources = [
    `${origin}/favicon.ico`,
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(origin)}&sz=32`,
  ];
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const selectedSource =
    loadedSource !== null && sources.includes(loadedSource) ? loadedSource : null;

  return (
    <span className={cn('relative', LINK_ICON_CLASS, className)}>
      {selectedSource === null ? <GlobeIcon aria-hidden className="size-full" /> : null}
      {sources.map((src) => (
        <img
          alt=""
          className={cn(
            'absolute inset-0 size-full',
            selectedSource === src ? 'opacity-100' : 'opacity-0',
          )}
          decoding="async"
          draggable={false}
          key={src}
          onLoad={() => {
            setLoadedSource((current) =>
              current !== null && sources.includes(current) ? current : src,
            );
          }}
          referrerPolicy="no-referrer"
          src={src}
        />
      ))}
    </span>
  );
}

export interface LinkTargetIconProps {
  target: LinkTarget;
  className?: string;
}

/** The icon for a classified link target: favicons for the web, file-identity icons for
 * workspace files, and glyphs for skill and plugin mentions. */
export function LinkTargetIcon({ target, className }: LinkTargetIconProps): React.ReactNode {
  switch (target.kind) {
    case 'web': {
      return <WebLinkIcon href={target.href} className={className} />;
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

export function UrlLinkIcon({
  url,
  className,
  fallback = null,
}: UrlLinkIconProps): React.ReactNode {
  const target = url === undefined ? null : linkTargetFor(url);
  if (target?.kind !== 'web') return fallback;
  return <LinkTargetIcon target={target} className={className} />;
}
