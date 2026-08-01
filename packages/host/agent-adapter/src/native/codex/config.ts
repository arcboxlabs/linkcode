import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { env } from 'node:process';
import type { EffortLevel } from '@linkcode/schema';
import { EffortLevelSchema } from '@linkcode/schema';
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

/** `$CODEX_HOME/config.toml` (`~/.codex` by default) with the active profile resolved, in the
 * lookup order codex itself uses: the profile's key if set, else the top-level one. Undefined when
 * the file is absent, unreadable, or invalid TOML — all treated alike as unconfigured. */
async function codexConfigScopes(
  environment: NodeJS.ProcessEnv,
): Promise<
  [profile: Record<string, unknown> | undefined, top: Record<string, unknown>] | undefined
> {
  let config: unknown;
  try {
    config = parseToml(await readFile(join(codexHome(environment), 'config.toml'), 'utf8'));
  } catch {
    return undefined;
  }
  if (!isRecord(config)) return undefined;
  const profileName = typeof config.profile === 'string' ? config.profile : undefined;
  const profiles = isRecord(config.profiles) ? config.profiles : undefined;
  return [
    profileName && isRecord(profiles?.[profileName]) ? profiles[profileName] : undefined,
    config,
  ];
}

/**
 * The sandbox configured in config.toml. Read only to decide whether a sandbox override may be
 * sent at all (codex resolves the config itself when none is sent) — a stricter configured choice
 * like read-only must never be silently loosened.
 */
export async function codexConfiguredSandbox(
  environment: NodeJS.ProcessEnv = env,
): Promise<CodexSandboxMode | undefined> {
  const scopes = await codexConfigScopes(environment);
  if (!scopes) return undefined;
  const [profile, top] = scopes;
  return asSandboxMode(profile?.sandbox_mode) ?? asSandboxMode(top.sandbox_mode);
}

/** The model and reasoning effort configured in config.toml, for the pre-session catalog only —
 * codex resolves these itself at `thread/start`, so they are never sent back as an override.
 * `minimal` is outside LinkCode's effort vocabulary and drops out here, same as in the live
 * catalog. */
export async function codexConfiguredModel(
  environment: NodeJS.ProcessEnv = env,
): Promise<{ model?: string; effort?: EffortLevel }> {
  const scopes = await codexConfigScopes(environment);
  if (!scopes) return {};
  const [profile, top] = scopes;
  const model = profile?.model ?? top.model;
  const parsedEffort = EffortLevelSchema.safeParse(
    profile?.model_reasoning_effort ?? top.model_reasoning_effort,
  );
  const effort =
    parsedEffort.success && parsedEffort.data !== 'ultracode' ? parsedEffort.data : undefined;
  return {
    ...(typeof model === 'string' && model.length > 0 && { model }),
    ...(effort !== undefined && { effort }),
  };
}
