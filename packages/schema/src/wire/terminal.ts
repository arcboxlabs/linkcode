import { z } from 'zod';
import {
  TerminalAttachmentCredentialsSchema,
  TerminalAttachmentIdSchema,
  TerminalAttachmentModeSchema,
  TerminalIdSchema,
  TerminalMetadataSchema,
  TerminalOpenOptionsSchema,
  TerminalReplayEventSchema,
  TerminalWinsizeSchema,
} from '../terminal';

/** Terminal wire variants (data plane): interactive PTYs the host owns; bytes travel as UTF-8
 * strings (host-side decode keeps the JSON wire base64-free). Attachment secrets are capabilities:
 * they only travel client → host and are never echoed in replies or broadcasts. */
export const terminalWireVariants = [
  z.object({ kind: z.literal('terminal.list'), clientReqId: z.string().min(1) }),
  z.object({
    kind: z.literal('terminal.listed'),
    replyTo: z.string().min(1),
    terminals: z.array(TerminalMetadataSchema),
  }),
  z.object({
    kind: z.literal('terminal.open'),
    clientReqId: z.string().min(1),
    opts: TerminalOpenOptionsSchema,
    ...TerminalAttachmentCredentialsSchema.shape,
  }),
  z.object({
    kind: z.literal('terminal.opened'),
    replyTo: z.string().min(1),
    terminal: TerminalMetadataSchema,
    replay: z.array(TerminalReplayEventSchema),
    cutoffSeq: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  z.object({
    kind: z.literal('terminal.attach'),
    clientReqId: z.string().min(1),
    terminalId: TerminalIdSchema,
    mode: TerminalAttachmentModeSchema,
    ...TerminalAttachmentCredentialsSchema.shape,
  }),
  z.object({
    kind: z.literal('terminal.attached'),
    replyTo: z.string().min(1),
    terminal: TerminalMetadataSchema,
    replay: z.array(TerminalReplayEventSchema),
    cutoffSeq: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  z.object({
    kind: z.literal('terminal.detach'),
    terminalId: TerminalIdSchema,
    ...TerminalAttachmentCredentialsSchema.shape,
  }),
  z.object({
    kind: z.literal('terminal.input'),
    terminalId: TerminalIdSchema,
    data: z.string(),
    ...TerminalAttachmentCredentialsSchema.shape,
  }),
  z.object({
    kind: z.literal('terminal.resize'),
    terminalId: TerminalIdSchema,
    ...TerminalAttachmentCredentialsSchema.shape,
    ...TerminalWinsizeSchema.shape,
  }),
  z.object({
    kind: z.literal('terminal.close'),
    terminalId: TerminalIdSchema,
    ...TerminalAttachmentCredentialsSchema.shape,
  }),
  z.object({
    kind: z.literal('terminal.output'),
    terminalId: TerminalIdSchema,
    seq: z.number().int().positive(),
    data: z.string(),
  }),
  z.object({
    kind: z.literal('terminal.resized'),
    terminalId: TerminalIdSchema,
    seq: z.number().int().positive(),
    ...TerminalWinsizeSchema.shape,
  }),
  z.object({
    kind: z.literal('terminal.controller.changed'),
    terminalId: TerminalIdSchema,
    controllerAttachmentId: TerminalAttachmentIdSchema.nullable(),
  }),
  z.object({
    kind: z.literal('terminal.exit'),
    terminalId: TerminalIdSchema,
    // null when the shell was terminated by a signal rather than exiting with a code.
    exitCode: z.number().int().nullable(),
  }),
] as const;
