import { z } from 'zod';

/**
 * Workspace scripts (directory-backed like git.*: keyed by cwd). Declared in the
 * workspace's `linkcode.json` under `scripts`; `service` scripts get a planned port,
 * the LINKCODE_* env contract, and a stable preview URL through the daemon's
 * Host-routed reverse proxy.
 */

export const ScriptTypeSchema = z.enum(['task', 'service']);
export type ScriptType = z.infer<typeof ScriptTypeSchema>;

/** Whether the script's process is running. Orthogonal to {@link ScriptHealth}. */
export const ScriptLifecycleSchema = z.enum(['idle', 'running', 'stopped']);
export type ScriptLifecycle = z.infer<typeof ScriptLifecycleSchema>;

/** Whether the service's port accepts TCP connections (services only; tasks stay `unknown`). */
export const ScriptHealthSchema = z.enum(['unknown', 'healthy', 'unhealthy']);
export type ScriptHealth = z.infer<typeof ScriptHealthSchema>;

export const WorkspaceScriptSchema = z.object({
  scriptName: z.string().min(1),
  type: ScriptTypeSchema,
  command: z.string().min(1),
  lifecycle: ScriptLifecycleSchema,
  health: ScriptHealthSchema,
  /** Planned local port (services only; assigned before first start so siblings can reference it). */
  port: z.number().int().positive().optional(),
  /** Proxy hostname, e.g. `web--app-1a2b3c.localhost` (services only). */
  hostname: z.string().min(1).optional(),
  /** Full preview URL through the daemon proxy, e.g. `http://web--app-1a2b3c.localhost:19523` (services only). */
  localProxyUrl: z.string().min(1).optional(),
  /** The managed PTY carrying the script's output; open in the terminal panel to view logs. */
  terminalId: z.string().min(1).optional(),
  /** Exit code of the last run once `stopped` (null when killed by signal). */
  exitCode: z.number().int().nullable().optional(),
});
export type WorkspaceScript = z.infer<typeof WorkspaceScriptSchema>;
