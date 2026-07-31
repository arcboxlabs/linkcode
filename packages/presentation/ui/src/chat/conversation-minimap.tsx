import {
  PreviewCard,
  PreviewCardPrimitive,
  PreviewCardTrigger,
} from 'coss-ui/components/preview-card';
import { clamp } from 'foxts/clamp';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import type { VirtualizerHandle } from 'virtua';
import { cn } from '../lib/cn';
import { SidePreviewCardPopup } from '../preview-card-popup';
import { useRenderPrefs } from '../render-prefs';
import { Markdown } from './markdown';
import {
  fisheyeFactor,
  fisheyeSize,
  MINIMAP_ROW_HEIGHT,
  MINIMAP_TURN_TICK,
  railScrollTopFor,
} from './minimap-geometry';
import type { TurnSegment } from './turn-edits';

/** Beyond this many rows a smooth jump pages the whole window through the viewport. */
const SMOOTH_JUMP_ROWS = 10;

/** Markdown excerpt fed to the preview card; the card masks off whatever overflows. */
const PREVIEW_BODY_CHARS = 600;

export interface MinimapVisibleRange {
  start: number;
  /** Inclusive. */
  end: number;
}

/**
 * Wires the rail to the virtualized column. One callback resolves the visible range *and* scrolls
 * the rail, so nothing has to watch either with an effect.
 */
export function useConversationMinimap(count: number): {
  virtualizerRef: React.RefObject<VirtualizerHandle | null>;
  railRef: React.RefObject<HTMLDivElement | null>;
  visible: MinimapVisibleRange;
  onScroll: (offset: number) => void;
  onSelect: (index: number) => void;
} {
  const virtualizerRef = useRef<VirtualizerHandle>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<MinimapVisibleRange | null>(null);
  const { reduceMotion } = useRenderPrefs();

  const onScroll = useCallback(
    (offset: number) => {
      const virtualizer = virtualizerRef.current;
      if (!virtualizer) return;
      const next = {
        start: virtualizer.findItemIndex(offset),
        end: virtualizer.findItemIndex(offset + virtualizer.viewportSize),
      };
      setRange((prev) => (prev?.start === next.start && prev.end === next.end ? prev : next));
      const rail = railRef.current;
      if (rail) rail.scrollTop = railScrollTopFor(next, count, rail.clientHeight);
    },
    [count],
  );

  const onSelect = useCallback(
    (index: number) => {
      const virtualizer = virtualizerRef.current;
      if (!virtualizer) return;
      const from = virtualizer.findItemIndex(virtualizer.scrollOffset);
      virtualizer.scrollToIndex(index, {
        align: 'start',
        smooth: !reduceMotion && Math.abs(index - from) <= SMOOTH_JUMP_ROWS,
      });
    },
    [reduceMotion],
  );

  return {
    virtualizerRef,
    railRef,
    onScroll,
    onSelect,
    // Until the first scroll every turn is on screen: true for a thread short enough never to
    // scroll, and corrected immediately by the initial jump to bottom on one that does.
    visible: range ?? { start: 0, end: count - 1 },
  };
}

function segmentText(segment: TurnSegment, role: 'user' | 'assistant'): string {
  for (const item of segment.items) {
    if (item.kind !== 'message' || item.role !== role) continue;
    const text = item.blocks
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();
    if (text) return text;
  }
  return '';
}

export interface ConversationMinimapProps {
  segments: readonly TurnSegment[];
  visible: MinimapVisibleRange;
  railRef: React.RefObject<HTMLDivElement | null>;
  onSelect: (index: number) => void;
  className?: string;
}

/**
 * Turn navigation rail in the reading column's left gutter — one evenly spaced tick per turn, not a
 * proportional minimap: under virtualization an unmounted row's offset is an estimate that shifts
 * as it measures, so mapping ticks to document height makes them drift.
 */
export function ConversationMinimap({
  segments,
  visible,
  railRef,
  onSelect,
  className,
}: ConversationMinimapProps): React.ReactNode {
  const t = useTranslations('workbench.conversation.minimap');
  const { reduceMotion } = useRenderPrefs();
  // One card serving every tick, so only the open turn's excerpt is ever built. Not a ref: base-ui
  // reads the handle while rendering both the triggers and the card.
  const handle = useMemo(() => PreviewCardPrimitive.createHandle<number>(), []);
  const listRef = useRef<HTMLDivElement>(null);
  const tickNodesRef = useRef<Array<HTMLElement | null>>([]);
  const buttonNodesRef = useRef<Array<HTMLElement | null>>([]);
  const pointerYRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const [focused, setFocused] = useState(0);

  const count = segments.length;
  const focusIndex = Math.min(focused, count - 1);

  // Magnification is a continuous per-frame value across every tick; routing it through state
  // would re-render the whole rail each frame, so the falloff is written straight to the nodes.
  // Row pitch is fixed, so one rect read locates all of them.
  const paint = useCallback(() => {
    frameRef.current = null;
    const list = listRef.current;
    if (!list) return;
    const pointerY = pointerYRef.current;
    const listTop = list.getBoundingClientRect().top;
    tickNodesRef.current.forEach((tick, index) => {
      if (!tick) return;
      if (pointerY === null) {
        tick.style.width = '';
        tick.style.height = '';
        return;
      }
      const center = listTop + index * MINIMAP_ROW_HEIGHT + MINIMAP_ROW_HEIGHT / 2;
      const { width, height } = fisheyeSize(MINIMAP_TURN_TICK, fisheyeFactor(center - pointerY));
      tick.style.width = `${width.toFixed(2)}px`;
      tick.style.height = `${height.toFixed(2)}px`;
    });
  }, []);

  const schedulePaint = useCallback(
    (pointerY: number | null) => {
      pointerYRef.current = pointerY;
      frameRef.current ??= requestAnimationFrame(paint);
    },
    [paint],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!reduceMotion) schedulePaint(event.clientY);
    },
    [reduceMotion, schedulePaint],
  );

  const handlePointerLeave = useCallback(() => {
    schedulePaint(null);
  }, [schedulePaint]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (delta === 0) return;
      event.preventDefault();
      const next = clamp(focusIndex + delta, 0, count - 1);
      setFocused(next);
      buttonNodesRef.current[next]?.focus();
    },
    [count, focusIndex],
  );

  if (count === 0) return null;

  return (
    <>
      <nav
        aria-label={t('label')}
        className={cn(
          'absolute inset-y-0 left-4 hidden w-10 opacity-40 transition-opacity duration-(--motion-fast) ease-(--motion-ease-out) focus-within:opacity-100 hover:opacity-100 @min-[55rem]/conversation:block',
          className,
        )}
      >
        <div
          className="flex h-full flex-col overflow-y-auto [scrollbar-width:none]"
          onPointerLeave={handlePointerLeave}
          onPointerMove={handlePointerMove}
          ref={railRef}
        >
          {/* Auto margins center a short stack and collapse once it outgrows the rail, which
              `justify-center` would instead clip at the top. */}
          <div className="m-auto flex flex-col" ref={listRef}>
            {segments.map((segment, index) => (
              <PreviewCardTrigger
                aria-label={t('turn', { index: index + 1 })}
                className="flex shrink-0 items-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                closeDelay={100}
                delay={300}
                handle={handle}
                key={segment.turnId ?? 'lead-in'}
                onClick={() => onSelect(index)}
                onKeyDown={handleKeyDown}
                payload={index}
                ref={(element) => {
                  buttonNodesRef.current[index] = element;
                }}
                render={<button type="button" />}
                style={{ height: MINIMAP_ROW_HEIGHT }}
                tabIndex={index === focusIndex ? 0 : -1}
              >
                {/* Resting size is `MINIMAP_TURN_TICK`'s base, in classes rather than `style` so a
                    re-render mid-hover can't clobber the magnification written to the node. */}
                <span
                  className={cn(
                    'h-[3px] w-3 rounded-full transition-[width,height,background-color] duration-(--motion-fast) ease-(--motion-ease-out)',
                    index >= visible.start && index <= visible.end
                      ? 'bg-label-tertiary'
                      : 'bg-label-quaternary',
                  )}
                  ref={(element) => {
                    tickNodesRef.current[index] = element;
                  }}
                />
              </PreviewCardTrigger>
            ))}
          </div>
        </div>
      </nav>
      <PreviewCard handle={handle}>
        {({ payload }) => {
          const segment = payload === undefined ? undefined : segments[payload];
          if (!segment) return null;
          const title = segmentText(segment, 'user');
          const body = segmentText(segment, 'assistant').slice(0, PREVIEW_BODY_CHARS);
          return (
            <SidePreviewCardPopup className="w-96 flex-col gap-2">
              <p className="line-clamp-1 font-medium text-foreground">
                {title || t('turn', { index: (payload ?? 0) + 1 })}
              </p>
              {body ? (
                <div className="max-h-40 overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]">
                  <Markdown>{body}</Markdown>
                </div>
              ) : null}
            </SidePreviewCardPopup>
          );
        }}
      </PreviewCard>
    </>
  );
}
