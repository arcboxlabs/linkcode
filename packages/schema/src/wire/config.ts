import { z } from 'zod';
import { AccountsSchema } from '../account';
import { ProvidersConfigSchema } from '../provider-config';

/** Host configuration wire variants — per-agent provider settings (provider-config.ts) plus the
 * global account pool (account.ts); both travel together so a single `config.get`/`config.set`
 * round-trips the whole editable config. */
export const configWireVariants = [
  z.object({ kind: z.literal('config.get'), clientReqId: z.string().min(1) }),
  z.object({
    kind: z.literal('config.get.result'),
    replyTo: z.string().min(1),
    providers: ProvidersConfigSchema,
    accounts: AccountsSchema,
  }),
  z.object({
    kind: z.literal('config.set'),
    clientReqId: z.string().min(1),
    /** Per-agent provider settings; omitted by a client editing only the account pool. */
    providers: ProvidersConfigSchema.optional(),
    /** The global account pool; omitted by a client editing only provider settings. */
    accounts: AccountsSchema.optional(),
  }),
] as const;
