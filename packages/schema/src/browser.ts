import { z } from 'zod';

/**
 * Browser automation contracts (CODE-267): a desktop client registers as THE browser host and
 * executes broker-dispatched operations in its Browser-pane webviews. Single active host —
 * commands have side effects, so they are never fanned out; the last registration wins.
 */

/** Closed set of operations the browser host executes. `tab.*` ops take `tabId` in args. */
export const BrowserOpSchema = z.enum([
  'tabs.list',
  'tabs.open',
  'tabs.select',
  'tab.navigate',
  'tab.back',
  'tab.reload',
  'tab.close',
  'tab.snapshot',
  'tab.click',
  'tab.type',
  'tab.screenshot',
  'tab.evaluate',
]);
export type BrowserOp = z.infer<typeof BrowserOpSchema>;

/** Envelope-level shape only; the executor validates per-op args in depth. */
export const BrowserCommandArgsSchema = z.record(z.string(), z.unknown());
export type BrowserCommandArgs = z.infer<typeof BrowserCommandArgsSchema>;

export const BrowserCommandErrorCodeSchema = z.enum([
  'host-unavailable',
  'timeout',
  'invalid-args',
  'no-such-tab',
  'stale-ref',
  'navigation-failed',
  'execution-failed',
  'not-allowed',
]);
export type BrowserCommandErrorCode = z.infer<typeof BrowserCommandErrorCodeSchema>;

export const BrowserCommandErrorSchema = z.object({
  code: BrowserCommandErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
});
export type BrowserCommandError = z.infer<typeof BrowserCommandErrorSchema>;

/** Settlement of one command; `data` is op-specific (tab list, snapshot, screenshot, …). */
export const BrowserCommandResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown().optional() }),
  z.object({ ok: z.literal(false), error: BrowserCommandErrorSchema }),
]);
export type BrowserCommandResult = z.infer<typeof BrowserCommandResultSchema>;

/** Host identity is a client-minted capability (mirrors terminal attachments): it travels
 * client → host on registration only and is never echoed in replies or broadcasts. */
export const BrowserHostCredentialsSchema = z.object({
  hostId: z.string().min(1).max(128),
  hostSecret: z.string().min(1).max(256),
});
export type BrowserHostCredentials = z.infer<typeof BrowserHostCredentialsSchema>;

// Op-payload shapes the desktop executor produces inside `data` (envelope-validated as unknown;
// the executor is first-party, so consumers narrow with these types instead of re-parsing).

export interface BrowserTabInfo {
  id: string;
  url: string | null;
  title: string | null;
  active: boolean;
}

/** One interactive element captured by `tab.snapshot`; `ref` (`@eN`) keys click/type targets
 * and goes stale as soon as the page navigates. */
export interface BrowserSnapshotNode {
  ref: string;
  role: string;
  name: string;
  value?: string;
}

export interface BrowserSnapshot {
  url: string;
  title: string;
  nodes: BrowserSnapshotNode[];
  /** True when the node list was cut at the collection cap. */
  truncated: boolean;
}
