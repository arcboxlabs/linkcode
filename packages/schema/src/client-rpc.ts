import { z } from 'zod';

/**
 * Client-side RPCs the agent can invoke on the client — mirrors ACP's fs/* and terminal/* methods.
 * Used by the generic ACP adapter; native SDK adapters handle their own filesystem/terminal access
 * internally and never emit these. Carried over the wire as a `client-request` AgentEvent (agent → client)
 * answered by a `client-response` AgentInput (client → agent), correlated by `requestId`.
 */

export const EnvVariableSchema = z.object({ name: z.string(), value: z.string() });
export type EnvVariable = z.infer<typeof EnvVariableSchema>;

export const TerminalExitStatusSchema = z.object({
  exitCode: z.number().int().optional(),
  signal: z.string().optional(),
});
export type TerminalExitStatus = z.infer<typeof TerminalExitStatusSchema>;

/** Agent → client request, keyed by ACP method name. */
export const ClientRequestSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('fs/read_text_file'),
    path: z.string(),
    line: z.number().int().optional(),
    limit: z.number().int().optional(),
  }),
  z.object({ method: z.literal('fs/write_text_file'), path: z.string(), content: z.string() }),
  z.object({
    method: z.literal('terminal/create'),
    command: z.string(),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.array(EnvVariableSchema).optional(),
    outputByteLimit: z.number().int().optional(),
  }),
  z.object({ method: z.literal('terminal/output'), terminalId: z.string() }),
  z.object({ method: z.literal('terminal/wait_for_exit'), terminalId: z.string() }),
  z.object({ method: z.literal('terminal/kill'), terminalId: z.string() }),
  z.object({ method: z.literal('terminal/release'), terminalId: z.string() }),
]);
export type ClientRequest = z.infer<typeof ClientRequestSchema>;

/** Client → agent response, matched to the request by `method`. */
export const ClientResponseSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('fs/read_text_file'), content: z.string() }),
  z.object({ method: z.literal('fs/write_text_file') }),
  z.object({ method: z.literal('terminal/create'), terminalId: z.string() }),
  z.object({
    method: z.literal('terminal/output'),
    output: z.string(),
    truncated: z.boolean(),
    exitStatus: TerminalExitStatusSchema.optional(),
  }),
  z.object({ method: z.literal('terminal/wait_for_exit'), exitStatus: TerminalExitStatusSchema }),
  z.object({ method: z.literal('terminal/kill') }),
  z.object({ method: z.literal('terminal/release') }),
]);
export type ClientResponse = z.infer<typeof ClientResponseSchema>;
