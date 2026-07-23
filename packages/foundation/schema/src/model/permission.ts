import { z } from 'zod';
import { ToolCallUpdateSchema } from './tool-call';

/** Permission flow with LinkCode-owned prompt copy and an optional tool/command subject. */

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

export const PermissionSubjectSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tool-call'), toolCallId: z.string().min(1) }),
  z.object({
    type: z.literal('command'),
    command: z.string().min(1),
    cwd: z.string().min(1),
    toolCallId: z.string().min(1).optional(),
    terminalId: z.string().min(1).optional(),
  }),
]);
export type PermissionSubject = z.infer<typeof PermissionSubjectSchema>;

/** New adapter-side request shape. The wire schema below also reads one generation of legacy
 * `{toolCall, options}` requests. */
export const PermissionPromptSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  subject: PermissionSubjectSchema,
});
export type PermissionPrompt = z.infer<typeof PermissionPromptSchema>;

export const PermissionRequestSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    subject: PermissionSubjectSchema.optional(),
    /** Legacy wire shape; new adapters announce the tool separately and send only its id. */
    toolCall: ToolCallUpdateSchema.optional(),
    options: PermissionOptionsSchema,
  })
  .superRefine((request, ctx) => {
    if (request.toolCall) return;
    if (!request.title) {
      ctx.addIssue({ code: 'custom', path: ['title'], message: 'Permission title is required' });
    }
    if (!request.subject) {
      ctx.addIssue({
        code: 'custom',
        path: ['subject'],
        message: 'Permission subject is required',
      });
    }
  });
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

/** The user's decision in response to a permission request. */
export const PermissionOutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('selected'), optionId: z.string().min(1) }),
  z.object({ outcome: z.literal('cancelled') }),
]);
export type PermissionOutcome = z.infer<typeof PermissionOutcomeSchema>;
