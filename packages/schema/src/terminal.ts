import { z } from 'zod';
import { SessionIdSchema, TimestampSchema } from './common';

/** Terminal contracts (data plane). Interactive PTYs the host owns; bytes travel as UTF-8 strings
 * (host-side streaming decode keeps the JSON wire base64-free) — see wire.ts's `terminal.*` variants. */

/** Capped at the sidecar's u16 winsize range; an out-of-range value would overflow its
 * deserialize and tear down the whole PTY host, so reject it at the wire boundary. */
export const TerminalWinsizeSchema = z.object({
  cols: z.number().int().positive().max(0xFFFF),
  rows: z.number().int().positive().max(0xFFFF),
});
export type TerminalWinsize = z.infer<typeof TerminalWinsizeSchema>;

export const TerminalOpenOptionsSchema = TerminalWinsizeSchema.extend({
  cwd: z.string().optional(),
  shell: z.string().optional(),
});
export type TerminalOpenOptions = z.infer<typeof TerminalOpenOptionsSchema>;

export const TerminalIdSchema = z.string().min(1);
export type TerminalId = z.infer<typeof TerminalIdSchema>;

export const TerminalAttachmentIdSchema = z.string().min(1).max(128);
export type TerminalAttachmentId = z.infer<typeof TerminalAttachmentIdSchema>;
export const TerminalAttachmentSecretSchema = z.string().min(32).max(256);
export type TerminalAttachmentSecret = z.infer<typeof TerminalAttachmentSecretSchema>;
export const TerminalAttachmentCredentialsSchema = z.object({
  attachmentId: TerminalAttachmentIdSchema,
  attachmentSecret: TerminalAttachmentSecretSchema,
});
export type TerminalAttachmentCredentials = z.infer<typeof TerminalAttachmentCredentialsSchema>;

export const TerminalAttachmentModeSchema = z.enum(['view', 'control']);
export type TerminalAttachmentMode = z.infer<typeof TerminalAttachmentModeSchema>;

export const TerminalMetadataSchema = TerminalWinsizeSchema.extend({
  terminalId: TerminalIdSchema,
  cwd: z.string().optional(),
  shell: z.string().optional(),
  sessionId: SessionIdSchema.optional(),
  managed: z.boolean(),
  createdAt: TimestampSchema,
  controllerAttachmentId: TerminalAttachmentIdSchema.nullable(),
});
export type TerminalMetadata = z.infer<typeof TerminalMetadataSchema>;

const TerminalReplaySequenceSchema = z.number().int().positive();
export const TerminalReplayEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('write'),
    seq: TerminalReplaySequenceSchema,
    data: z.string(),
  }),
  z.object({
    type: z.literal('resize'),
    seq: TerminalReplaySequenceSchema,
    ...TerminalWinsizeSchema.shape,
  }),
]);
export type TerminalReplayEvent = z.infer<typeof TerminalReplayEventSchema>;
