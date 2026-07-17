import { z } from 'zod';
import { AgentKindSchema } from '../common';

/**
 * Interactive provider-login wire variants: the host runs the agent CLI's own OAuth login as a
 * short-lived headless child. `start` is request/reply (replyTo carries a `loginId`); the host
 * then pushes the authorize `url`, the client sends back the pasted `submit-code`
 * (fire-and-forget), and `settled` broadcasts the terminal outcome; `cancel` aborts. Only
 * claude-code is implemented host-side; other kinds settle with an error.
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
