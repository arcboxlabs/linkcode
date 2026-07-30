import { z } from 'zod';
import {
  AccountEndpointSchema,
  AccountModelSchema,
  AccountSecretSchema,
  AccountsSchema,
} from '../model/account';
import { ProvidersConfigSchema } from '../model/provider-config';
import { WireRequestIdSchema } from './request';

/** Host configuration wire variants — per-agent provider settings (provider-config.ts) plus the
 * global account pool (account.ts); both travel together so a single `config.get`/`config.set`
 * round-trips the whole editable config. */
export const configWireVariants = [
  z.object({ kind: z.literal('config.get'), clientReqId: WireRequestIdSchema }),
  z.object({
    kind: z.literal('config.get.result'),
    replyTo: WireRequestIdSchema,
    providers: ProvidersConfigSchema,
    accounts: AccountsSchema,
  }),
  z.object({
    kind: z.literal('config.set'),
    clientReqId: WireRequestIdSchema,
    /** Per-agent provider settings; omitted by a client editing only the account pool. */
    providers: ProvidersConfigSchema.optional(),
    /** The global account pool; omitted by a client editing only provider settings. */
    accounts: AccountsSchema.optional(),
  }),
  /** Enumerate what an endpoint serves, before the account is saved: the daemon reads the
   * endpoint's own model list with the given secret. The client cannot do this itself — the
   * renderer's CSP blocks remote fetches, and only the daemon may hold the secret. */
  z.object({
    kind: z.literal('config.probe-models'),
    clientReqId: WireRequestIdSchema,
    endpoint: AccountEndpointSchema,
    secret: AccountSecretSchema,
  }),
  z.object({
    kind: z.literal('config.probe-models.result'),
    replyTo: WireRequestIdSchema,
    models: z.array(AccountModelSchema),
  }),
] as const;
