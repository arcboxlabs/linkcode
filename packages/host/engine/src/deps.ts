import type { AdapterFactory } from '@linkcode/agent-adapter';
import type { AgentRuntimes } from '@linkcode/schema';
import type { LoginBinaryResolver } from './agent/login-service';
import type { ProviderConfigStore } from './agent/provider-config';
import type { TranslatorService } from './agent/translator';
import type { AssetService } from './asset/service';
import type { LoopStore, ScheduleStore } from './automation';
import type { GitService } from './git/git-service';
import type { PreviewRouteRegistry } from './preview/route-registry';
import type { SessionStore } from './session/session-store';
import type { SimulatorBackend } from './simulator/backend';
import type { PtyBackend } from './terminal/pty-backend';
import type { FileSuggestService } from './workspace/file-suggest-service';
import type { WorkspaceStore } from './workspace/workspace-store';

/** Optional collaborators the daemon injects; each defaults to an in-memory/no-op implementation. */
export interface EngineDeps {
  factory?: AdapterFactory;
  sessionStore?: SessionStore;
  ptyBackend?: PtyBackend;
  /** iOS Simulator sidecar client (macOS hosts only); absent Engines have no simulator surface. */
  simulatorBackend?: SimulatorBackend;
  providerStore?: ProviderConfigStore;
  git?: GitService;
  fileSuggest?: FileSuggestService;
  workspaceStore?: WorkspaceStore;
  /** Shared with the transport's reverse proxy; scripts need a PTY backend to run. */
  previewRoutes?: PreviewRouteRegistry;
  /** Boot-time probe result (`collectAgentRuntimes()`), served to clients on `agent-runtime.list`. */
  agentRuntimes?: AgentRuntimes;
  /** In-flight boot probe (CODE-225). The daemon binds listeners without waiting on the CLI
   * spawns behind `collect()`, handing the pending promise in instead: the engine seeds the
   * snapshot from it, holds `agent-runtime.list` replies and live-session starts until it
   * settles, and pushes the seeded result as `agent-runtime.changed`. */
  agentRuntimesReady?: Promise<AgentRuntimes>;
  /** Managed-asset store, served on `asset.list` and driven by `asset.ensure`. */
  assets?: AssetService;
  /** Re-probe hook: refreshes the served runtime snapshot after a managed agent install lands,
   * a login settles, a turn fails on auth, or a client read revalidates it (CODE-172). */
  collectAgentRuntimes?: () => Promise<AgentRuntimes>;
  /** Resolves the CLI to spawn for an interactive `agent-login`; absent hosts reject login requests. */
  resolveLoginBinary?: LoginBinaryResolver;
  /** Local Anthropic⇄OpenAI translation sidecar; absent Engines reject cross-protocol accounts. */
  translator?: TranslatorService;
  /** Durable store for schedules; the in-memory default keeps bare engines and tests dependency-free. */
  scheduleStore?: ScheduleStore;
  /** Durable store for loops; the in-memory default keeps bare engines and tests dependency-free. */
  loopStore?: LoopStore;
}
