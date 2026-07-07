import { z } from 'zod';
import { AgentKindSchema } from './common';

/**
 * Where the spawnable CLI behind an agent kind comes from, in resolution order:
 * `bundled` — the exact SDK-paired binary staged by the packaged host (`LINKCODE_AGENT_BIN_DIR`);
 * `detected` — a user-installed CLI found at a known install location and version-probed;
 * `sdk` — the SDK resolves its own platform package out of node_modules (dev / standalone daemon);
 * `builtin` — no external binary at all (pi runs in-process).
 */
export const AgentRuntimeSourceSchema = z.enum(['bundled', 'detected', 'sdk', 'builtin']);
export type AgentRuntimeSource = z.infer<typeof AgentRuntimeSourceSchema>;

export const AgentRuntimeAvailabilitySchema = z.object({
  /**
   * `out-of-range` is reserved: it is emitted once the compat manifest (CODE-77) gates detected
   * versions against the app's compatible range; until then a detected runtime reports `available`.
   */
  status: z.enum(['available', 'out-of-range', 'missing']),
  source: AgentRuntimeSourceSchema.optional(),
  /** Absolute binary path; absent for `sdk` (resolution happens inside the SDK) and `builtin`. */
  path: z.string().optional(),
  /** CLI version as reported by `--version`; absent when the source carries no probeable binary. */
  version: z.string().optional(),
});
export type AgentRuntimeAvailability = z.infer<typeof AgentRuntimeAvailabilitySchema>;

/** Per-agent-kind runtime availability; kinds the host has not evaluated are simply absent. */
export const AgentRuntimesSchema = z.partialRecord(AgentKindSchema, AgentRuntimeAvailabilitySchema);
export type AgentRuntimes = z.infer<typeof AgentRuntimesSchema>;
