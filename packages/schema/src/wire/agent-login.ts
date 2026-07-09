import { z } from 'zod';
import { AgentKindSchema } from '../common';

/**
 * Interactive provider-login wire variants. The host drives the agent CLI's own OAuth login
 * (claude-code: `claude auth login`) as a short-lived headless child — piped stdio, no PTY.
 * `start` is request/reply (clientReqId → replyTo carrying a `loginId`); the host then pushes the
 * authorize `url` for the client to open in a browser, the client sends back the pasted
 * `submit-code` (fire-and-forget, like terminal input), and `settled` broadcasts the terminal
 * outcome. `cancel` aborts. Only claude-code is implemented host-side; other kinds settle with an
 * error.
 */
export const agentLoginWireVariants = [
  z.object({
    kind: z.literal('agent-login.start'),
    clientReqId: z.string().min(1),
    agent: AgentKindSchema,
  }),
  z.object({
    kind: z.literal('agent-login.started'),
    replyTo: z.string().min(1),
    loginId: z.string().min(1),
  }),
  z.object({ kind: z.literal('agent-login.url'), loginId: z.string().min(1), url: z.url() }),
  z.object({
    kind: z.literal('agent-login.submit-code'),
    loginId: z.string().min(1),
    code: z.string().min(1),
  }),
  z.object({ kind: z.literal('agent-login.cancel'), loginId: z.string().min(1) }),
  z.object({
    kind: z.literal('agent-login.settled'),
    loginId: z.string().min(1),
    ok: z.boolean(),
    error: z.string().optional(),
  }),
] as const;
