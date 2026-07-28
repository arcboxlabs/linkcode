import { z } from 'zod';

/** Correlates a client request with its reply. */
export const WireRequestIdSchema = z.string().min(1);

/** Generic replies for correlated requests that return no resource-specific payload. */
export const requestWireVariants = [
  z.object({
    kind: z.literal('request.failed'),
    replyTo: WireRequestIdSchema,
    message: z.string(),
    code: z.string().optional(),
  }),
  z.object({
    kind: z.literal('request.succeeded'),
    replyTo: WireRequestIdSchema,
  }),
] as const;
