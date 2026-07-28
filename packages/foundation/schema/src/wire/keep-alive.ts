import { z } from 'zod';

/** Keep-alive wire variants — ping/pong pass through the transport's keep-alive machinery. */
export const keepAliveWireVariants = [
  z.object({ kind: z.literal('ping') }),
  z.object({ kind: z.literal('pong') }),
] as const;
