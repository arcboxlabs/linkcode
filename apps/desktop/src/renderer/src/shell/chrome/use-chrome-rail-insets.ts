import { useLayoutEffect } from 'foxact/use-isomorphic-layout-effect';
import type { RefObject } from 'react';
import { DESKTOP_CHROME_METRICS } from './metrics';

type ChromeRailInsetProperty = '--lc-chrome-left-local-inset' | '--lc-chrome-right-local-inset';

interface ChromeRailInsetRefs {
  rootRef: RefObject<HTMLElement | null>;
  leftRailContentRef: RefObject<HTMLElement | null>;
  rightRailContentRef: RefObject<HTMLElement | null>;
}

const LEFT_LOCAL_INSET_PROPERTY = '--lc-chrome-left-local-inset';
const RIGHT_LOCAL_INSET_PROPERTY = '--lc-chrome-right-local-inset';

export function useChromeRailInsets({
  rootRef,
  leftRailContentRef,
  rightRailContentRef,
}: ChromeRailInsetRefs): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const syncInsets = (): void => {
      setRailInset(root, LEFT_LOCAL_INSET_PROPERTY, leftRailContentRef.current);
      setRailInset(root, RIGHT_LOCAL_INSET_PROPERTY, rightRailContentRef.current);
    };

    syncInsets();

    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(syncInsets);
    if (leftRailContentRef.current) observer.observe(leftRailContentRef.current);
    if (rightRailContentRef.current) observer.observe(rightRailContentRef.current);

    return () => {
      observer.disconnect();
      root.style.removeProperty(LEFT_LOCAL_INSET_PROPERTY);
      root.style.removeProperty(RIGHT_LOCAL_INSET_PROPERTY);
    };
  }, [leftRailContentRef, rightRailContentRef, rootRef]);
}

function setRailInset(
  root: HTMLElement,
  property: ChromeRailInsetProperty,
  contentElement: HTMLElement | null,
): void {
  const contentWidth = contentElement?.getBoundingClientRect().width ?? 0;
  const inset =
    contentWidth > 0
      ? DESKTOP_CHROME_METRICS.edgePadding + contentWidth + DESKTOP_CHROME_METRICS.controlGap
      : DESKTOP_CHROME_METRICS.edgePadding;

  root.style.setProperty(property, `${inset}px`);
}
