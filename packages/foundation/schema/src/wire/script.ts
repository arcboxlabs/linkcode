import { z } from 'zod';
import { WorkspaceScriptSchema } from '../model/script';
import { WireRequestIdSchema } from './request';

/** Workspace-script wire variants — directory-backed: keyed by cwd (see script.ts). */
export const scriptWireVariants = [
  z.object({
    kind: z.literal('script.list'),
    clientReqId: WireRequestIdSchema,
    cwd: z.string().min(1),
  }),
  z.object({
    kind: z.literal('script.listed'),
    replyTo: WireRequestIdSchema,
    scripts: z.array(WorkspaceScriptSchema),
  }),
  /** Start a declared script; replies `request.succeeded`/`request.failed`, state flows via `script.status`. */
  z.object({
    kind: z.literal('script.start'),
    clientReqId: WireRequestIdSchema,
    cwd: z.string().min(1),
    scriptName: z.string().min(1),
  }),
  z.object({
    kind: z.literal('script.stop'),
    clientReqId: WireRequestIdSchema,
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
