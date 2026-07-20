import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { isRecord } from '../../history-util';
import { codexHome } from './history';

export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

const SANDBOX_MODES: readonly CodexSandboxMode[] = [
  'read-only',
  'workspace-write',
  'danger-full-access',
];

function asSandboxMode(value: unknown): CodexSandboxMode | undefined {
  return SANDBOX_MODES.find((mode) => mode === value);
}

/**
 * The sandbox configured in `~/.codex/config.toml`: the active profile's `sandbox_mode` if set,
 * else the top-level one; undefined when unset or the file is absent/malformed. Read only to
 * decide whether a sandbox override may be sent at all (codex resolves the config itself when
 * none is sent) — a stricter configured choice like read-only must never be silently loosened.
 */
export async function codexConfiguredSandbox(): Promise<CodexSandboxMode | undefined> {
  let config: unknown;
  try {
    config = parseToml(await readFile(join(codexHome(), 'config.toml'), 'utf8'));
  } catch {
    return undefined; // No config, unreadable, or invalid TOML — treat as unconfigured.
  }
  if (!isRecord(config)) return undefined;
  const profileName = typeof config.profile === 'string' ? config.profile : undefined;
  const profiles = isRecord(config.profiles) ? config.profiles : undefined;
  const profile =
    profileName && isRecord(profiles?.[profileName]) ? profiles[profileName] : undefined;
  return asSandboxMode(profile?.sandbox_mode) ?? asSandboxMode(config.sandbox_mode);
}
