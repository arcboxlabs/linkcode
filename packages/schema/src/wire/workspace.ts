import { z } from 'zod';
import { WorkspaceIdSchema } from '../model/primitives';
import { WorkspaceKindSchema, WorkspaceRecordSchema } from '../model/workspace';
import { WireRequestIdSchema } from './request';

/** Workspace wire variants — registered directories (see workspace.ts). */
export const workspaceWireVariants = [
  z.object({ kind: z.literal('workspace.list'), clientReqId: WireRequestIdSchema }),
  z.object({
    kind: z.literal('workspace.listed'),
    replyTo: WireRequestIdSchema,
    workspaces: z.array(WorkspaceRecordSchema),
  }),
  z.object({
    kind: z.literal('workspace.register'),
    clientReqId: WireRequestIdSchema,
    cwd: z.string().min(1),
    name: z.string().min(1).optional(),
    /** Omitted by every current call site (the daemon defaults to `'project'`); see workspace.ts. */
    workspaceKind: WorkspaceKindSchema.optional(),
  }),
  z.object({
    kind: z.literal('workspace.registered'),
    replyTo: WireRequestIdSchema,
    record: WorkspaceRecordSchema,
  }),
  z.object({
    kind: z.literal('workspace.update'),
    clientReqId: WireRequestIdSchema,
    workspaceId: WorkspaceIdSchema,
    name: z.string().min(1),
  }),
  z.object({
    kind: z.literal('workspace.archive'),
    clientReqId: WireRequestIdSchema,
    workspaceId: WorkspaceIdSchema,
  }),
] as const;
