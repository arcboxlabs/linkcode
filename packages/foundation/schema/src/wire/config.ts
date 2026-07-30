import { z } from 'zod';
import { AccountsSchema } from '../model/account';
import { CustomMcpServerPatchOpSchema, CustomMcpServerPublicSchema } from '../model/custom-mcp';
import { ProvidersConfigSchema } from '../model/provider-config';
import { WireRequestIdSchema } from './request';

/** Host configuration wire variants — per-agent provider settings (provider-config.ts) plus the
 * global account pool (account.ts); both travel together so a single `config.get`/`config.set`
 * round-trips the whole editable config. Custom MCP servers ride the same pair but read as a
 * masked projection and write as patch ops (custom-mcp.ts). */
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
