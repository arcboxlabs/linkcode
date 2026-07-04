import { z } from 'zod';
import { SessionIdSchema } from './common';

/**
 * Terminal contracts (data plane). Interactive PTYs the host owns; bytes travel as UTF-8
 * strings over the wire (host-side streaming decode keeps the JSON wire base64-free) — see
 * wire.ts's `terminal.*` variants.
 */

/**
 * Capped at the sidecar's u16 winsize range; an out-of-range value would overflow its
 * deserialize and tear down the whole PTY host, so reject it at the wire boundary.
 */
export const TerminalWinsizeSchema = z.object({
  cols: z.number().int().positive().max(0xFFFF),
  rows: z.number().int().positive().max(0xFFFF),
});
export type TerminalWinsize = z.infer<typeof TerminalWinsizeSchema>;

export const TerminalOpenOptionsSchema = TerminalWinsizeSchema.extend({
  cwd: z.string().optional(),
  shell: z.string().optional(),
  /** Present for agent-owned terminals so the host can reap them when the session stops. */
  sessionId: SessionIdSchema.optional(),
});
export type TerminalOpenOptions = z.infer<typeof TerminalOpenOptionsSchema>;
