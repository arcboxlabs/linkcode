import { z } from 'zod';
import { ToolCallUpdateSchema } from './tool-call';

/** Tool-call permission flow — mirrors ACP session/request_permission. */

export const PermissionOptionKindSchema = z.enum([
  'allow_once',
  'allow_always',
  'reject_once',
  'reject_always',
]);
export type PermissionOptionKind = z.infer<typeof PermissionOptionKindSchema>;

export const PermissionOptionSchema = z.object({
  optionId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  kind: PermissionOptionKindSchema,
});
export type PermissionOption = z.infer<typeof PermissionOptionSchema>;

/** The agent's permission ask: which tool call, and the options the user may pick from. */
const PermissionOptionsSchema = z
  .array(PermissionOptionSchema)
  .min(1)
  .superRefine((options, ctx) => {
    const optionIds = new Set<string>();
    for (const [index, option] of options.entries()) {
      if (optionIds.has(option.optionId)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'optionId'],
          message: `Duplicate permission option ID: ${option.optionId}`,
        });
      }
      optionIds.add(option.optionId);
    }
  });

export const PermissionRequestSchema = z.object({
  toolCall: ToolCallUpdateSchema,
  options: PermissionOptionsSchema,
});
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

/** The user's decision in response to a permission request. */
export const PermissionOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('selected'), optionId: z.string().min(1) }),
  z.object({ outcome: z.literal('cancelled') }),
]);
export type PermissionOutcome = z.infer<typeof PermissionOutcomeSchema>;
