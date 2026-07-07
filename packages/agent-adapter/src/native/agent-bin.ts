import { existsSync } from 'node:fs';
import path from 'node:path';
import { env } from 'node:process';

/**
 * Resolve a vendored agent CLI from the host-provided binary directory (`LINKCODE_AGENT_BIN_DIR`,
 * set by the packaged desktop's daemon supervisor to `<resources>/agent-bin`, staged per target
 * platform by the desktop's stage-agent-runtimes script). Layout: `<dir>/<agent-kind>/<binary>`.
 *
 * Returns undefined when the host provides no directory or the binary is absent (dev shells,
 * tests, standalone daemon) — callers then leave the SDK to resolve its own platform package
 * from node_modules. An explicit real path matters in packaged hosts: the SDK's own resolution
 * lands inside the asar, which the OS cannot spawn from.
 */
export function vendoredAgentBinary(kind: string, binary: string): string | undefined {
  const dir = env.LINKCODE_AGENT_BIN_DIR;
  if (!dir) return undefined;
  const file = path.join(dir, kind, binary);
  return existsSync(file) ? file : undefined;
}
