import { z } from 'zod';
import { ManagedAssetStatusSchema } from '../managed-asset';

/**
 * Managed-asset wire surface (CODE-111): pull-only status for now. The download trigger and
 * progress broadcast arrive with the onboarding UI (CODE-112), which decides their shape.
 */
export const managedAssetWireVariants = [
  z.object({ kind: z.literal('asset.list'), clientReqId: z.string().min(1) }),
  z.object({
    kind: z.literal('asset.listed'),
    replyTo: z.string().min(1),
    assets: z.array(ManagedAssetStatusSchema),
  }),
] as const;
