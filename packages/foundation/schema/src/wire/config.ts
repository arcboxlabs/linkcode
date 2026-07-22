import { z } from 'zod';
import { AccountsSchema } from '../model/account';
import { PluginConfigPublicSchema, PluginConfigSetSchema } from '../model/plugin';
import { ProvidersConfigSchema } from '../model/provider-config';
import { WireRequestIdSchema } from './request';

/** Host configuration wire variants: per-agent providers, the global account pool, and plugin
 * enablement/local connections. The catalog is a separate read-only wire resource. */
export const configWireVariants = [
  z.object({ kind: z.literal('config.get'), clientReqId: WireRequestIdSchema }),
  z.object({
    kind: z.literal('config.get.result'),
    replyTo: WireRequestIdSchema,
    providers: ProvidersConfigSchema,
    accounts: AccountsSchema,
    plugins: PluginConfigPublicSchema,
  }),
  z.object({
    kind: z.literal('config.set'),
    clientReqId: WireRequestIdSchema,
    /** Per-agent provider settings; omitted by a client editing only the account pool. */
    providers: ProvidersConfigSchema.optional(),
    /** The global account pool; omitted by a client editing only provider settings. */
    accounts: AccountsSchema.optional(),
    /** Global plugin state and daemon-local connector operations. */
    plugins: PluginConfigSetSchema.optional(),
  }),
] as const;
