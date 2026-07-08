import { z } from 'zod';
import {
  InstalledAssetSchema,
  ManagedAssetIdSchema,
  ManagedAssetStatusSchema,
} from '../managed-asset';

/**
 * Managed-asset wire surface (CODE-111/112): pull status, trigger installs, observe progress.
 *
 * `asset.ensure` is correlated and replies only once the install settles — the pending registry
 * has no timeout, so a multi-minute download resolves the same promise (a disconnect rejects it
 * via `failAll`); failures reply with the generic `request.failed`. `asset.progress` and
 * `asset.settled` are broadcasts (no correlation, own routing key — like `script.status`) so
 * boot-time background installs are just as visible as client-triggered ones.
 */
export const managedAssetWireVariants = [
  z.object({ kind: z.literal('asset.list'), clientReqId: z.string().min(1) }),
  z.object({
    kind: z.literal('asset.listed'),
    replyTo: z.string().min(1),
    assets: z.array(ManagedAssetStatusSchema),
  }),
  z.object({
    kind: z.literal('asset.ensure'),
    clientReqId: z.string().min(1),
    id: ManagedAssetIdSchema,
  }),
  z.object({
    kind: z.literal('asset.ensured'),
    replyTo: z.string().min(1),
    status: ManagedAssetStatusSchema,
  }),
  z.object({
    kind: z.literal('asset.progress'),
    id: ManagedAssetIdSchema,
    receivedBytes: z.number().int().nonnegative(),
    /** Absent when neither the artifact declares a size nor the response carries content-length. */
    totalBytes: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal('asset.settled'),
    id: ManagedAssetIdSchema,
    /** Present on success; on failure `error` carries the message instead. */
    installed: InstalledAssetSchema.optional(),
    error: z.string().optional(),
  }),
] as const;
