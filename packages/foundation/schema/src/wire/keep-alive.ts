import { z } from 'zod';

/** Keep-alive wire variants — ping/pong pass through the transport's keep-alive machinery, and
 * carry the version exchange: the answer states what the host speaks and how far back it reaches,
 * so a client learns it is talking past its peer at handshake instead of by timing out. */
export const keepAliveWireVariants = [
  z.object({ kind: z.literal('ping') }),
  z.object({
    kind: z.literal('pong'),
    version: z.number().int(),
    minCompatible: z.number().int(),
  }),
] as const;
