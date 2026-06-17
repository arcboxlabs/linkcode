import { z } from 'zod';

/**
 * Token usage / cost. Not part of ACP's session/update vocabulary — a Link Code addition so the UI can
 * surface consumption. Each adapter fills what its SDK reports; the rest stay undefined.
 */
export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheCreationTokens: z.number().int().nonnegative().optional(),
  totalCostUsd: z.number().nonnegative().optional(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
