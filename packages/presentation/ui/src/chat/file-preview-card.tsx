import { Badge } from 'coss-ui/components/badge';
import { Frame } from 'coss-ui/components/frame';
import { falseFn, noop } from 'foxts/noop';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'use-intl';
import { cn } from '../lib/cn';
import { fileBasename } from './artifacts/file-kind';
import type { ArtifactNavigation } from './artifacts/host-actions';
import { artifactNavigationAction, useArtifactHostActions } from './artifacts/host-actions';
import {
  ChatCardActions,
  ChatCardFooter,
  ChatCardHeader,
  ChatCardPanel,
  ChatCardTitle,
} from './chat-card';
import {
  CHAT_DISCLOSURE_TITLE_CLASS_NAME,
  CHAT_DISCLOSURE_TRIGGER_CLASS_NAME,
  ChatDisclosureChevron,
} from './disclosure-header';
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
  const t = useTranslations('workbench.tool');
  // The body starts clamped to a peek rather than hidden: a long diff shouldn't dominate the
  // timeline, but a card showing nothing at all is worse than one showing too much. Height-clamped
  // (not unmounted) so the peek is real content and expanding never re-renders the body.
  const [expanded, setExpanded] = useState(false);
  // State, not a ref: a tool card announces header-only and grows its body on the settle, so the
  // panel is absent on the first render. A ref read inside the subscribe would be null then, and
  // `useSyncExternalStore` only resubscribes when the subscribe identity changes — the card would
  // stay unmeasured for the rest of its life.
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  // Observed rather than measured once: the diff renderer highlights asynchronously, so a body
  // that fits on first paint can outgrow the clamp a frame later. Children are observed too — a
  // body sitting exactly at the clamp grows without moving the panel's own box.
  const subscribeToPanelSize = useCallback(
    (onChange: () => void): (() => void) => {
      if (!panel || typeof ResizeObserver === 'undefined') return noop;
      const observer = new ResizeObserver(onChange);
      observer.observe(panel);
      for (const child of panel.children) observer.observe(child);
      return () => observer.disconnect();
    },
    [panel],
  );
  // `overflow: clip` still reports the full scroll height, so this holds while clamped.
  const readPanelOverflow = useCallback(
    (): boolean => (panel ? panel.scrollHeight > panel.clientHeight : false),
    [panel],
  );
  const panelOverflowing = useSyncExternalStore(subscribeToPanelSize, readPanelOverflow, falseFn);
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
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-3 py-1.5 text-left outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:text-foreground"
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
        <>
          <ChatCardPanel
            className={cn(
              panelClassName,
              // Clamp whenever collapsed — that is what makes the overflow measurable — but fade
              // only when something is genuinely hidden behind it.
              !expanded && 'chat-card-peek',
              !expanded && panelOverflowing && 'chat-card-peek-fade',
            )}
            ref={setPanel}
            // `overflow: clip` hides the overflow visually but leaves its links and checkboxes in
            // the tab order, and a clipped box cannot be scrolled to bring them into view. Reveal
            // the body instead of letting focus land somewhere invisible. Guarded so a body that
            // fits never sprouts a collapse control just because something in it was focused.
            onFocus={() => {
              if (panelOverflowing) setExpanded(true);
            }}
          >
            {children}
          </ChatCardPanel>
          {/* A body that fits the peek has nothing to reveal, so it gets no toggle. Stays mounted
              once expanded: collapsing shrinks the panel back under the clamp, and dropping the
              control then would strand the card open. */}
          {panelOverflowing || expanded ? (
            <ChatCardFooter>
              <button
                aria-expanded={expanded}
                className={cn(CHAT_DISCLOSURE_TRIGGER_CLASS_NAME, 'w-fit max-w-full text-xs')}
                type="button"
                onClick={() => setExpanded((value) => !value)}
              >
                <span className={CHAT_DISCLOSURE_TITLE_CLASS_NAME}>
                  {expanded ? t('collapse') : t('expand')}
                </span>
                {/* Expands downward, collapses upward — not the tree-node right→down chevron. */}
                <ChatDisclosureChevron className={expanded ? '-rotate-90' : 'rotate-90'} />
              </button>
            </ChatCardFooter>
          ) : null}
        </>
      )}
    </Frame>
  );
}
