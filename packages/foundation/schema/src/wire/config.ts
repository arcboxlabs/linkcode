import { z } from 'zod';
import {
  AccountModelSchema,
  AccountSchema,
  AccountSecretSchema,
  AccountsSchema,
} from '../model/account';
import { CustomMcpServerPatchOpSchema, CustomMcpServerPublicSchema } from '../model/custom-mcp';
import { AgentKindSchema } from '../model/primitives';
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
  z.object({
    kind: z.literal('config.account.create-and-bind'),
    clientReqId: WireRequestIdSchema,
    agent: AgentKindSchema,
    account: AccountSchema,
  }),
  /** Enumerate the ids a service serves. The daemon resolves the list URL from the service catalog
   * and makes the call itself — the renderer's CSP blocks remote fetches, and the secret belongs on
   * that side. `inline` carries a secret the add form has not saved yet; `account` names a saved one
   * so its stored secret never travels back out to the client. */
  z.object({
    kind: z.literal('config.probe-models'),
    clientReqId: WireRequestIdSchema,
    service: z.string().min(1),
    credential: z.discriminatedUnion('type', [
      z.object({ type: z.literal('inline'), secret: AccountSecretSchema }),
      z.object({ type: z.literal('account'), accountId: z.string().min(1) }),
    ]),
  }),
  z.object({
    kind: z.literal('config.probe-models.result'),
    replyTo: WireRequestIdSchema,
    models: z.array(AccountModelSchema),
  }),
] as const;
