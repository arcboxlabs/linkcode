import { z } from 'zod';
import { AccountsSchema } from '../model/account';
import { CustomMcpServerPatchOpSchema, CustomMcpServerPublicSchema } from '../model/custom-mcp';
import { ProvidersConfigSchema } from '../model/provider-config';
import { WireRequestIdSchema } from './request';

/** Host configuration wire variants. Reads return the whole editable config; each write changes
 * one resource so validation or persistence failure cannot partially commit another resource. */
export const configWireVariants = [
  z.object({ kind: z.literal('config.get'), clientReqId: WireRequestIdSchema }),
  z.object({
    kind: z.literal('config.get.result'),
    replyTo: WireRequestIdSchema,
    providers: ProvidersConfigSchema,
    accounts: AccountsSchema,
    customMcpServers: z.array(CustomMcpServerPublicSchema),
  }),
  z.object({
    kind: z.literal('config.set'),
    clientReqId: WireRequestIdSchema,
    /** Per-agent provider settings; omitted by a client editing only the account pool. */
    providers: ProvidersConfigSchema.optional(),
    /** The global account pool; omitted by a client editing only provider settings. */
    accounts: AccountsSchema.optional(),
    /** Patch ops against the stored custom MCP servers; omitted when untouched. */
    customMcpServers: z.array(CustomMcpServerPatchOpSchema).optional(),
  }),
] as const;
