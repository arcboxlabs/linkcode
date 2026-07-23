import { z } from 'zod';
import { McpPluginCatalogSchema } from '../model/plugin';
import { WireRequestIdSchema } from './request';

export const pluginWireVariants = [
  z.object({ kind: z.literal('plugin.catalog.get'), clientReqId: WireRequestIdSchema }),
  z.object({
    kind: z.literal('plugin.catalog.result'),
    replyTo: WireRequestIdSchema,
    catalog: McpPluginCatalogSchema,
  }),
] as const;
