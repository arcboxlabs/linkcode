import { z } from 'zod';
import {
  GitDiffModeSchema,
  GitDiffSchema,
  GitPullRequestStatusSchema,
  GitStatusSchema,
} from '../model/git';
import { WireRequestIdSchema } from './request';

/** Git wire variants — directory-backed: keyed by `cwd`, shared by same-cwd sessions (see git.ts). */
export const gitWireVariants = [
  z.object({
    kind: z.literal('git.status.get'),
    clientReqId: WireRequestIdSchema,
    cwd: z.string().min(1),
  }),
  z.object({
    kind: z.literal('git.status.get.result'),
    replyTo: WireRequestIdSchema,
    status: GitStatusSchema,
  }),
  z.object({
    kind: z.literal('git.pr_status.get'),
    clientReqId: WireRequestIdSchema,
    cwd: z.string().min(1),
  }),
  z.object({
    kind: z.literal('git.pr_status.get.result'),
    replyTo: WireRequestIdSchema,
    prStatus: GitPullRequestStatusSchema,
  }),
  z.object({
    kind: z.literal('git.diff.get'),
    clientReqId: WireRequestIdSchema,
    cwd: z.string().min(1),
    mode: GitDiffModeSchema,
  }),
  z.object({
    kind: z.literal('git.diff.get.result'),
    replyTo: WireRequestIdSchema,
    diff: GitDiffSchema,
  }),
] as const;
