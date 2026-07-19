import { z } from 'zod';
import { WorkspaceScriptSchema } from '../model/script';

/** Workspace-script wire variants — directory-backed: keyed by cwd (see script.ts). */
export const scriptWireVariants = [
  z.object({
    kind: z.literal('script.list'),
    clientReqId: z.string().min(1),
    cwd: z.string().min(1),
  }),
  z.object({
    kind: z.literal('script.listed'),
    replyTo: z.string().min(1),
    scripts: z.array(WorkspaceScriptSchema),
  }),
  /** Start a declared script; replies `request.succeeded`/`request.failed`, state flows via `script.status`. */
  z.object({
    kind: z.literal('script.start'),
    clientReqId: z.string().min(1),
    cwd: z.string().min(1),
    scriptName: z.string().min(1),
  }),
  z.object({
    kind: z.literal('script.stop'),
    clientReqId: z.string().min(1),
    cwd: z.string().min(1),
    scriptName: z.string().min(1),
  }),
  /** Uncorrelated event emitted on every lifecycle/health change. */
  z.object({
    kind: z.literal('script.status'),
    cwd: z.string().min(1),
    script: WorkspaceScriptSchema,
  }),
] as const;
