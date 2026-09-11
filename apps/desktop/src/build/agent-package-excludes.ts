import type { AgentKind } from '@linkcode/schema';

/**
 * Per-kind node_modules package paths for the agent SDKs actually staged in the deploy closure
 * (CODE-618). Platform CLI binaries are already excluded for every build by the shared
 * electron-builder.yml globs (CODE-114); this table only covers the pure-JS SDK entry packages a
 * restricted brand does not declare. `pi`'s SDK is a hosted download (never staged) and
 * `grok-build` has no SDK, so neither needs an entry. Single source of truth for both the
 * packaging exclusion globs (below) and verify-artifacts.mts's post-pack assertion.
 */
export const AGENT_SDK_PACKAGE_PATHS: Readonly<Partial<Record<AgentKind, readonly string[]>>> = {
  'claude-code': ['node_modules/@anthropic-ai/claude-agent-sdk'],
  codex: ['node_modules/@openai/codex'],
  opencode: ['node_modules/@opencode-ai/sdk'],
};

/**
 * Exclusion globs for every agent kind not in `allowedAgents`. `null` (unrestricted, the default
 * build) is an exact no-op — an empty array, so packaging stays on its unmodified config.
 */
export function agentFilesExcludes(allowedAgents: readonly AgentKind[] | null): string[] {
  if (allowedAgents === null) return [];
  const allowed = new Set(allowedAgents);
  const excludes: string[] = [];
  for (const [kind, paths] of Object.entries(AGENT_SDK_PACKAGE_PATHS)) {
    if (!allowed.has(kind as AgentKind)) excludes.push(...paths.map((path) => `!${path}/**`));
  }
  return excludes;
}
