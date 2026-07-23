import { BookTextIcon, FileTextIcon, GlobeIcon, PuzzleIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/cn';
import { FileIdentityIcon } from './file-identity-icon';
import type { LinkTarget } from './link-target';
import { faviconSrcFor, linkTargetFor } from './link-target';

const LINK_ICON_CLASS = 'inline-block size-3.5 shrink-0 align-text-bottom';

/** Favicon srcs that already failed once, remembered module-wide: streaming re-parses remount
 * the tail markdown block, and re-attempting a known-dead URL flickers the fallback icon. */
const failedFaviconSrcs = new Set<string>();

export interface FaviconProps {
  hostname: string;
  className?: string;
}

/** Website favicon, degrading to a globe glyph when the fetch fails (offline, blocked).
 * Pure presentation: the browser fetches and caches per hostname. */
export function Favicon({ hostname, className }: FaviconProps): React.ReactNode {
  const src = faviconSrcFor(hostname);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src || failedFaviconSrcs.has(src)) {
    return <GlobeIcon aria-hidden className={cn(LINK_ICON_CLASS, className)} />;
  }
  return (
    <img
      alt=""
      aria-hidden
      className={cn(LINK_ICON_CLASS, className)}
      decoding="async"
      loading="lazy"
      onError={() => {
        failedFaviconSrcs.add(src);
        setFailedSrc(src);
      }}
      referrerPolicy="no-referrer"
      src={src}
    />
  );
}

export interface UrlFaviconProps {
  url?: string;
  className?: string;
  /** Rendered when the url is absent or not a web link. */
  fallback?: React.ReactNode;
}

/** Favicon for a url string when it classifies as a web link; the fallback otherwise. */
export function UrlFavicon({ url, className, fallback = null }: UrlFaviconProps): React.ReactNode {
  const target = url === undefined ? null : linkTargetFor(url);
  if (target?.kind !== 'web') return fallback;
  return <Favicon hostname={target.hostname} className={className} />;
}

export interface LinkTargetIconProps {
  target: LinkTarget;
  className?: string;
}

/** The icon for a classified link target: favicons for the web, file-identity icons for
 * workspace files, glyphs for skill and plugin mentions. Extend here for new target kinds. */
export function LinkTargetIcon({ target, className }: LinkTargetIconProps): React.ReactNode {
  switch (target.kind) {
    case 'web': {
      return <Favicon hostname={target.hostname} className={className} />;
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
