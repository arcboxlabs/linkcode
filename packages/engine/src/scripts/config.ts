import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ScriptType } from '@linkcode/schema';
import { z } from 'zod';

/** A script declared in the workspace's `linkcode.json` `scripts` section. */
export interface ScriptDeclaration {
  name: string;
  type: ScriptType;
  command: string;
  /** Declared fixed port (services only); otherwise the planner allocates one. */
  preferredPort?: number;
}

export const WORKSPACE_CONFIG_FILENAME = 'linkcode.json';

/** `{ command }` is a plain task; `{ type: "service", command, port? }` gets the proxy. */
const ScriptEntrySchema = z.object({
  type: z.enum(['task', 'service']).optional(),
  command: z.string().min(1),
  port: z.number().int().positive().max(65535).optional(),
});

/**
 * Read the workspace's declared scripts, leniently: a missing/broken file or section
 * yields no scripts, and each malformed entry is dropped alone (the config file is
 * user-edited; one typo must not take down the whole list).
 */
export function readWorkspaceScripts(cwd: string): ScriptDeclaration[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path.join(cwd, WORKSPACE_CONFIG_FILENAME), 'utf8'));
  } catch {
    return [];
  }
  if (parsed === null || typeof parsed !== 'object') return [];
  const scripts = (parsed as Record<string, unknown>).scripts;
  if (scripts === null || typeof scripts !== 'object') return [];

  const declarations: ScriptDeclaration[] = [];
  for (const [name, raw] of Object.entries(scripts as Record<string, unknown>)) {
    const entry = ScriptEntrySchema.safeParse(raw);
    if (!entry.success || name.trim().length === 0) continue;
    const type = entry.data.type ?? 'task';
    declarations.push({
      name,
      type,
      command: entry.data.command,
      preferredPort: type === 'service' ? entry.data.port : undefined,
    });
  }
  return declarations;
}
