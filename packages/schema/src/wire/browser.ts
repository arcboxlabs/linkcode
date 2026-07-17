import { z } from 'zod';
import {
  BrowserCommandArgsSchema,
  BrowserCommandResultSchema,
  BrowserHostCredentialsSchema,
  BrowserOpSchema,
} from '../browser';

/** Browser-broker wire variants (CODE-267): a desktop client registers as THE single active
 * browser host (last registration wins); the daemon dispatches commands to that connection only
 * and correlates settlements by the daemon-minted `commandId`. */
export const browserWireVariants = [
  // Client → host: claim the browser-host role for this connection (replies via
  // request.succeeded / request.failed; the Hub starts targeting on the success reply).
  z.object({
    kind: z.literal('browser.host.register'),
    clientReqId: z.string().min(1),
    ...BrowserHostCredentialsSchema.shape,
  }),
  // Synthesized by the Hub when the registered host's connection closes (mirrors the
  // synthetic terminal.detach); hostId guards against a stale disconnect clearing a newer host.
  z.object({ kind: z.literal('browser.host.detached'), hostId: z.string().min(1) }),
  // Host → clients broadcast: whether a browser host is currently registered.
  z.object({ kind: z.literal('browser.host.changed'), available: z.boolean() }),
  // Host push (delivered ONLY to the registered browser-host connection): execute one op.
  z.object({
    kind: z.literal('browser.command'),
    commandId: z.string().min(1),
    op: BrowserOpSchema,
    args: BrowserCommandArgsSchema,
  }),
  // Browser host → daemon: settle one command.
  z.object({
    kind: z.literal('browser.command.result'),
    commandId: z.string().min(1),
    result: BrowserCommandResultSchema,
  }),
  // Any client → daemon (the B-2 stdio bridge): run one op through the broker.
  z.object({
    kind: z.literal('browser.execute'),
    clientReqId: z.string().min(1),
    op: BrowserOpSchema,
    args: BrowserCommandArgsSchema,
  }),
  z.object({
    kind: z.literal('browser.executed'),
    replyTo: z.string().min(1),
    result: BrowserCommandResultSchema,
  }),
] as const;
