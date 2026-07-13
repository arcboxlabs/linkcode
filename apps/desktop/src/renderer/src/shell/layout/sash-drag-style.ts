import { invariant } from 'foxact/invariant';
import type { SashPane } from './sash-model';
import { getResolvedReclaimTrack } from './sash-model';

export interface SashDragStyleWriter {
  apply(size: number): void;
  restore(): void;
}

/** Half the 8px sash hit area — keep in sync with the offsets in index.css. */
const SASH_CENTER_OFFSET = 4;

/**
 * Live sash drags bypass the `--lc-*` shell variables: rewriting an inherited custom
 * property re-resolves style across the whole shell subtree (~14ms/frame measured, killing
 * 120Hz), while writing the resolved tracks inline on the few consuming elements stays
 * well under 1ms. The templates and sash offsets mirror `.linkcode-shell-grid` /
 * `.linkcode-sash-*` in index.css and CHROME_BACKGROUND_GRID_STYLE in chrome.tsx.
 * `restore()` puts every touched declaration back (the chrome grid keeps a React-owned
 * inline template, so values are snapshotted, not cleared) and the settled size then goes
 * through the variable writers once on release.
 */
export function createSashDragStyleWriter(
  sashElement: HTMLElement,
  pane: SashPane,
  minMainSize: number,
  reclaimPreferredSize: number,
  reclaimMinSize: number,
): SashDragStyleWriter {
  const grid = sashElement.parentElement;
  invariant(grid, 'A shell sash must be a direct child of the workspace grid');
  const frame = grid.closest<HTMLElement>('.linkcode-shell-frame');
  invariant(frame, 'The workspace grid must be inside the shell frame');
  const chromeGrid = frame.querySelector<HTMLElement>('.linkcode-chrome-grid');
  invariant(chromeGrid, 'Missing chrome grid for shell sash');
  const querySash = (selector: string): HTMLElement => {
    const el = grid.querySelector<HTMLElement>(selector);
    invariant(el, `Missing ${selector} for shell sash`);
    return el;
  };
  const sidebarSash = querySash('.linkcode-sash-sidebar');
  const rightSash = querySash('.linkcode-sash-right');
  const bottomSash = querySash('.linkcode-sash-bottom');
  // The grid spans the frame, so its rect is the 100cqw the CSS clamps resolve against.
  // Measured once: the window cannot resize mid-drag.
  const frameSize = grid.getBoundingClientRect().width;

  const touched: Array<[CSSStyleDeclaration, string, string]> = [];
  const write = (element: HTMLElement, property: string, value: string): void => {
    if (!touched.some(([style, name]) => style === element.style && name === property)) {
      touched.push([element.style, property, element.style.getPropertyValue(property)]);
    }
    element.style.setProperty(property, value);
  };

  const apply = (size: number): void => {
    if (pane === 'bottom') {
      write(grid, 'grid-template-rows', `minmax(0, 1fr) ${size}px`);
      write(bottomSash, 'bottom', `${size - SASH_CENTER_OFFSET}px`);
      write(rightSash, 'inset-block-end', `${size}px`);
      return;
    }
    if (pane === 'sidebar') {
      const reclaim = getResolvedReclaimTrack(
        size,
        frameSize,
        minMainSize,
        reclaimPreferredSize,
        reclaimMinSize,
      );
      const columns = `${size}px minmax(0, 1fr) ${reclaim}px`;
      write(grid, 'grid-template-columns', columns);
      write(chromeGrid, 'grid-template-columns', columns);
      write(sidebarSash, 'left', `${size - SASH_CENTER_OFFSET}px`);
      write(rightSash, 'right', `${reclaim - SASH_CENTER_OFFSET}px`);
      write(bottomSash, 'left', `${size}px`);
      return;
    }
    const columns = `var(--lc-sidebar-col) minmax(0, 1fr) ${size}px`;
    write(grid, 'grid-template-columns', columns);
    write(chromeGrid, 'grid-template-columns', columns);
    write(rightSash, 'right', `${size - SASH_CENTER_OFFSET}px`);
  };

  const restore = (): void => {
    for (const [style, property, value] of touched) style.setProperty(property, value);
    touched.length = 0;
  };

  return { apply, restore };
}
