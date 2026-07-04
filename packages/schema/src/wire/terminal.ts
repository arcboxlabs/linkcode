import { z } from 'zod';
import { TerminalOpenOptionsSchema, TerminalWinsizeSchema } from '../terminal';

/**
 * Terminal wire variants (data plane). Interactive PTYs the host owns; bytes travel as UTF-8
 * strings (host-side streaming decode keeps the JSON wire base64-free). `open` is request/reply
 * (clientReqId → replyTo); input/resize/close are fire-and-forget so keystrokes never pay a
 * round-trip; output/exit broadcast like `agent.event`.
 */
export const terminalWireVariants = [
  z.object({
    kind: z.literal('terminal.open'),
    clientReqId: z.string().min(1),
    opts: TerminalOpenOptionsSchema,
  }),
  z.object({
    kind: z.literal('terminal.opened'),
    replyTo: z.string().min(1),
    terminalId: z.string().min(1),
  }),
  z.object({ kind: z.literal('terminal.input'), terminalId: z.string().min(1), data: z.string() }),
  z.object({
    kind: z.literal('terminal.resize'),
    terminalId: z.string().min(1),
    ...TerminalWinsizeSchema.shape,
  }),
  z.object({ kind: z.literal('terminal.close'), terminalId: z.string().min(1) }),
  z.object({ kind: z.literal('terminal.output'), terminalId: z.string().min(1), data: z.string() }),
  z.object({
    kind: z.literal('terminal.exit'),
    terminalId: z.string().min(1),
    // null when the shell was terminated by a signal rather than exiting with a code.
    exitCode: z.number().int().nullable(),
  }),
] as const;
