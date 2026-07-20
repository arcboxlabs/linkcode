import { z } from 'zod';
import { AccountProtocolSchema, AccountsSchema, EndpointModelSchema } from '../model/account';
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
  /** Ask the daemon to query an endpoint's model-listing API (the add-account form's fetch step).
   * Daemon-proxied because renderers cannot reach arbitrary user endpoints (desktop CSP, browser
   * CORS). Endpoints without a listing (404 etc.) reject the request — the form falls back to
   * manual entry. */
  z.object({
    kind: z.literal('endpoint.list-models'),
    clientReqId: z.string().min(1),
    baseUrl: z.url(),
    protocol: AccountProtocolSchema,
    secret: z.string().min(1),
    credentialType: z.enum(['api-key', 'auth-token']),
  }),
  z.object({
    kind: z.literal('endpoint.models-listed'),
    replyTo: z.string().min(1),
    models: z.array(EndpointModelSchema),
  }),
] as const;
