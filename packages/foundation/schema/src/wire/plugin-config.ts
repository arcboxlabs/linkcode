import { z } from 'zod';
import {
  LinkCodePluginIdSchema,
  LinkCodePluginSettingsSchema,
  LinkCodePluginVersionSchema,
} from '../model/linkcode-plugin';
import { WireRequestIdSchema } from './request';

/** A stored setting value: the manifest's restricted JSON-Schema subset maps to these primitives. */
const PluginConfigValueSchema = z.union([z.string(), z.number(), z.boolean()]);

/** LinkCode plugin configuration wire variants. Read returns field schemas (so the client renders a
 * form without executing plugin code) plus masked values — secret fields are omitted, mirroring the
 * custom-MCP masked-edit contract. Write is a per-key patch: typed values set, keys removed. */
export const pluginConfigWireVariants = [
  z.object({
    kind: z.literal('plugin-config.list.get'),
    clientReqId: WireRequestIdSchema,
  }),
  z.object({
    kind: z.literal('plugin-config.listed'),
    replyTo: WireRequestIdSchema,
    plugins: z.array(
      z.object({
        id: LinkCodePluginIdSchema,
        version: LinkCodePluginVersionSchema,
        settings: LinkCodePluginSettingsSchema,
        values: z.record(z.string().min(1), PluginConfigValueSchema),
      }),
    ),
  }),
  z.object({
    kind: z.literal('plugin-config.set'),
    clientReqId: WireRequestIdSchema,
    pluginId: LinkCodePluginIdSchema,
    set: z.record(z.string().min(1), PluginConfigValueSchema).optional(),
    remove: z.array(z.string().min(1)).optional(),
  }),
  z.object({
    kind: z.literal('plugin-config.updated'),
    replyTo: WireRequestIdSchema,
    pluginId: LinkCodePluginIdSchema,
    values: z.record(z.string().min(1), PluginConfigValueSchema),
  }),
] as const;
