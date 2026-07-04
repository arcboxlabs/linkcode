import { z } from 'zod';
import { ProvidersConfigSchema } from '../provider-config';

/** Host configuration wire variants — the daemon-owned provider config (see provider-config.ts). */
export const configWireVariants = [
  z.object({ kind: z.literal('config.get'), clientReqId: z.string().min(1) }),
  z.object({
    kind: z.literal('config.get.result'),
    replyTo: z.string().min(1),
    providers: ProvidersConfigSchema,
  }),
  z.object({
    kind: z.literal('config.set'),
    clientReqId: z.string().min(1),
    providers: ProvidersConfigSchema,
  }),
] as const;
