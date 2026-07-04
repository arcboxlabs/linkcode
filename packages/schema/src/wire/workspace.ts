import { z } from 'zod';
import { WorkspaceIdSchema } from '../common';
import { WorkspaceKindSchema, WorkspaceRecordSchema } from '../workspace';

/** Workspace wire variants — registered directories (see workspace.ts). */
export const workspaceWireVariants = [
  z.object({ kind: z.literal('workspace.list'), clientReqId: z.string().min(1) }),
  z.object({
    kind: z.literal('workspace.listed'),
    replyTo: z.string().min(1),
    workspaces: z.array(WorkspaceRecordSchema),
  }),
  z.object({
    kind: z.literal('workspace.register'),
    clientReqId: z.string().min(1),
    cwd: z.string().min(1),
    name: z.string().min(1).optional(),
    /** Omitted by every current call site (the daemon defaults to `'project'`); see workspace.ts. */
    workspaceKind: WorkspaceKindSchema.optional(),
  }),
  z.object({
    kind: z.literal('workspace.registered'),
    replyTo: z.string().min(1),
    record: WorkspaceRecordSchema,
  }),
  z.object({
    kind: z.literal('workspace.update'),
    clientReqId: z.string().min(1),
    workspaceId: WorkspaceIdSchema,
    name: z.string().min(1),
  }),
  z.object({
    kind: z.literal('workspace.archive'),
    clientReqId: z.string().min(1),
    workspaceId: WorkspaceIdSchema,
  }),
] as const;
