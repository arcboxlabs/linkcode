import { z } from 'zod';
import { WorkspaceFileSchema } from '../file';

/** File wire variants — directory-backed: keyed by cwd + path, shared by same-cwd sessions (see file.ts). */
export const fileWireVariants = [
  z.object({
    kind: z.literal('file.read'),
    clientReqId: z.string().min(1),
    /** Directory a relative `path` resolves against (the session's workspace root). */
    cwd: z.string().min(1),
    /** Absolute, or relative to `cwd`; may point outside the workspace. */
    path: z.string().min(1),
  }),
  z.object({
    kind: z.literal('file.read.result'),
    replyTo: z.string().min(1),
    file: WorkspaceFileSchema,
  }),
] as const;
