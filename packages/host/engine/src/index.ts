/**
 * @linkcode/engine — the local core engine (docs/ARCHITECTURE.md#packages--repo-layout): the
 * "host" that runs the agents. The package root exposes only the daemon composition contract;
 * feature implementations stay package-internal.
 */

export type { ProviderConfigStore } from './agent/provider-config';
export type { TranslatorService, TranslatorUpstream } from './agent/translator';
export type { AssetService } from './asset/service';
export type { LoopStore, ScheduleStore } from './automation';
export type { EngineDeps } from './deps';
export { PreviewRouteRegistry } from './preview/route-registry';
export {
  EngineInfrastructure,
  EngineLive,
  EngineService,
  makeEngineInfrastructureLayer,
  makeEngineLayer,
} from './service';
export { MCP_CAPABLE_AGENT_KINDS, SIMULATOR_MCP_SERVER_NAME } from './session/mcp-capability';
export type { SessionStore } from './session/session-store';
export type {
  SimulatorBackend,
  SimulatorDeviceInfo,
  SimulatorImageFormat,
  SimulatorProbe,
} from './simulator/backend';
export type { SimulatorConsentStore } from './simulator/consent';
export { InMemorySimulatorConsentStore, SimulatorConsentService } from './simulator/consent';
export type { SimulatorMcpProvider } from './simulator/mcp';
export { SimulatorService } from './simulator/service';
export type { PtyBackend, PtyOpenOptions, PtyProcess } from './terminal/pty-backend';
export type { WorkspaceStore } from './workspace/workspace-store';
export type { WorktreeStore } from './worktree/worktree-store';
