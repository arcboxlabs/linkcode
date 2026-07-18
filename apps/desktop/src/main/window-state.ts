import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Rectangle } from 'electron';
import { app, screen } from 'electron';
import { clamp } from 'foxts/clamp';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { z } from 'zod';

/**
 * Persisted window geometry (system plane, like settings.ts): JSON under `userData`, so the
 * channel × profile identity isolates installs. Written once when the window closes; not part
 * of the IPC settings surface.
 */

export const MIN_WINDOW_SIZE = { width: 940, height: 600 } as const;

/* The first-launch cap is the full layout's natural width: sidebar 288 + chat column 824
 * (max-w-3xl + px-7 gutters) + right panel 440 (renderer DEFAULT_LAYOUT). */
const MAX_DEFAULT_SIZE = { width: 1560, height: 980 } as const;
const WORK_AREA_FRACTION = { width: 0.9, height: 0.92 } as const;

/** Smallest top-chrome area that must remain on-display so the window can be dragged. */
const GRABBABLE_CHROME = { width: 100, height: 48 } as const;

const WindowStateSchema = z.object({
  bounds: z.object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().min(MIN_WINDOW_SIZE.width),
    height: z.number().int().min(MIN_WINDOW_SIZE.height),
  }),
  maximized: z.boolean(),
  fullScreen: z.boolean(),
});

export type PersistedWindowState = z.infer<typeof WindowStateSchema>;

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json');
}

/** First-launch size: a work-area fraction, capped at the full layout's natural width. */
export function deriveDefaultWindowSize(): { width: number; height: number } {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: clamp(
      Math.round(width * WORK_AREA_FRACTION.width),
      MIN_WINDOW_SIZE.width,
      MAX_DEFAULT_SIZE.width,
    ),
    height: clamp(
      Math.round(height * WORK_AREA_FRACTION.height),
      MIN_WINDOW_SIZE.height,
      MAX_DEFAULT_SIZE.height,
    ),
  };
}

/** Null unless a valid state exists AND its top chrome remains grabbable on a display. */
export function readWindowState(): PersistedWindowState | null {
  let state: PersistedWindowState;
  try {
    state = WindowStateSchema.parse(JSON.parse(readFileSync(windowStatePath(), 'utf8')));
  } catch {
    return null;
  }
  return boundsOnSomeDisplay(state.bounds) ? state : null;
}

function boundsOnSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const visibleWidth =
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) -
      Math.max(bounds.x, workArea.x);
    const visibleChromeHeight =
      Math.min(bounds.y + GRABBABLE_CHROME.height, workArea.y + workArea.height) -
      Math.max(bounds.y, workArea.y);
    return visibleWidth >= GRABBABLE_CHROME.width && visibleChromeHeight >= GRABBABLE_CHROME.height;
  });
}

/** The BrowserWindow slice the snapshot reads — lets tests pass a plain fake without casts. */
interface SnapshotWindow {
  on: (event: 'close', listener: () => void) => unknown;
  getNormalBounds: () => Rectangle;
  isMaximized: () => boolean;
  isFullScreen: () => boolean;
}

/**
 * Snapshots geometry on 'close'. getNormalBounds() reports the normal-state frame regardless of
 * maximize/fullscreen/minimize, so no resize/move tracking (and none of its mid-transition races).
 */
export function persistWindowStateOnClose(win: SnapshotWindow): void {
  win.on('close', () => {
    const state: PersistedWindowState = {
      bounds: win.getNormalBounds(),
      maximized: win.isMaximized(),
      fullScreen: win.isFullScreen(),
    };
    try {
      const file = windowStatePath();
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
    } catch (err) {
      // Best-effort: losing geometry must not turn quit into a crash.
      process.stderr.write(
        `[link-code/desktop] unable to persist window state: ${extractErrorMessage(err)}\n`,
      );
    }
  });
}
