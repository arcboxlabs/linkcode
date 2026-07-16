import { agentRuntimeProber } from '@linkcode/agent-adapter';
import { AssetManager } from '@linkcode/assets';
import { Engine, PreviewRouteRegistry } from '@linkcode/engine';
import type { DaemonIdentity, DaemonListenerInfo } from '@linkcode/schema';
import { DAEMON_EXIT_ALREADY_RUNNING } from '@linkcode/schema';
import type { TransportServer } from '@linkcode/transport/server';
import { Hub } from '@linkcode/transport/server';
import { extractErrorMessage } from 'foxts/extract-error-message';
import { noop } from 'foxts/noop';
import { once } from 'foxts/once';
import { createAiGatewaySidecar } from './ai-gateway';
import { installAsarSpawnFix } from './asar-spawn';
import { chatWorkspaceRoot, daemonProfile, databasePath, loadConfig } from './config';
import { runLoginCommand, runLogoutCommand } from './hq/login';
import { startHqUplink } from './hq/uplink';
import { createProviderConfigStore } from './provider-store';
import { resolveSidecarPath, SidecarPtyBackend } from './pty/sidecar';
import {
  DaemonAlreadyRunningError,
  findRunningDaemon,
  listenWithPortHunt,
  removeRuntimeFile,
  writeRuntimeFile,
} from './runtime';
import { createSessionStore } from './session-store';
import { createWorkspaceStore } from './workspace-store';

// After an uncaught exception the process state (live sessions, mid-writes) is untrustworthy —
// die loudly rather than keep serving clients from an unknown state.
process.on('uncaughtException', (err) => {
  console.error('[linkcode/daemon] uncaught exception:', err);
  process.exit(1);
});

// An unhandled rejection is scoped to one async operation — the rest of the daemon stays
// coherent, so log instead of exiting. Reaching here means a fire-and-forget path missed its
// `.catch`; fix that path.
process.on('unhandledRejection', (reason) => {
  console.error('[linkcode/daemon] unhandled rejection:', reason);
});

/**
 * Link Code daemon — the standalone local host process: one shared `Engine` behind a fan-out
 * `Hub`, exposing configured listeners to clients. Real agents live here — they spawn CLI
 * subprocesses and hold credentials, so they cannot run inside a browser tab.
 */
async function main(): Promise<void> {
  // Resolved before anything (subcommands included) touches state paths: an invalid
  // LINKCODE_PROFILE must abort here, not mid-command or as a default-profile daemon.
  const profile = daemonProfile();

  // Subcommands run and exit instead of booting the host (a running daemon
  // picks the new sign-in state up on its next restart).
  const command = process.argv[2];
  if (command === 'login') return runLoginCommand();
  if (command === 'logout') return runLogoutCommand();

  // Before the engine starts: agent adapters spawn vendored CLI binaries that resolve inside the
  // desktop app's asar (no-op outside Electron — see asar-spawn.ts).
  installAsarSpawnFix();

  const config = loadConfig();

  // One daemon per profile — a second instance would share this profile's daemon.db and split
  // sessions. Daemons of other profiles live in sibling state dirs and are not visible here.
  const running = await findRunningDaemon();
  if (running) {
    const urls = running.listeners.map((listener) => listener.url).join(', ');
    console.error(`[linkcode/daemon] already running (pid ${running.pid}) at ${urls}`);
    // Explicit exit, not exitCode+return: under utilityProcess the parent IPC channel keeps the
    // event loop alive forever, so a natural exit never happens and the supervisor never hears it.
    process.exit(DAEMON_EXIT_ALREADY_RUNNING);
  }

  const identity: DaemonIdentity = {
    name: 'linkcode-daemon',
    pid: process.pid,
    startedAt: Date.now(),
    ...(profile !== undefined && { profile }),
  };
  const hub = new Hub();
  const store = createProviderConfigStore(config.providers ?? {}, config.accounts ?? []);
  // Written by the engine's script service, read by every listener's reverse proxy. Preview
  // traffic bypasses daemon auth by decision — the loopback bind is the boundary; remote exposure
  // is the tunnel's job.
  const previewRoutes = new PreviewRouteRegistry();
  // Managed assets (CODE-111): GC superseded versions before anything can spawn, then feed the
  // store into spawn resolution — managed wins over detected as soon as an install lands on disk.
  const assets = new AssetManager();
  const gc = assets.gcAtBoot();
  if (gc.removed.length > 0) {
    console.log(`[linkcode/daemon] assets gc: removed ${gc.removed.join(', ')}`);
  }
  if (gc.skipped.length > 0) {
    console.warn(`[linkcode/daemon] assets gc: skipped ${gc.skipped.join(', ')}`);
  }
  agentRuntimeProber.setManagedResolver((kind) => assets.managedBinary(`agent:${kind}`));
  // Probed once per boot (user-installed CLIs self-update, so results must not outlive a boot);
  // fills the adapters' spawn-path resolution and is served to clients on `agent-runtime.list`.
  const agentRuntimes = await agentRuntimeProber.collect();
  const engine = new Engine(hub, {
    providerStore: store,
    ptyBackend: new SidecarPtyBackend(resolveSidecarPath()),
    sessionStore: createSessionStore(databasePath()),
    workspaceStore: createWorkspaceStore(databasePath()),
    previewRoutes,
    agentRuntimes,
    assets,
    // Lets the engine refresh (and push) the runtime snapshot after a managed install lands.
    collectAgentRuntimes: () => agentRuntimeProber.collect(),
    // Spawn path for an interactive claude-code/codex login (managed/detected/SDK platform binary).
    resolveLoginBinary: (agent) =>
      agent === 'claude-code' || agent === 'codex'
        ? agentRuntimeProber.loginBinaryPath(agent)
        : undefined,
    // Local Anthropic⇄OpenAI translation for cross-protocol accounts (arcboxlabs/aigateway sidecar).
    // The binary installs on demand from the managed-asset store; LINKCODE_AIGATEWAY_PATH overrides.
    translator: createAiGatewaySidecar({
      ensureBinary: async () => (await assets.ensure('tool:aigateway'))?.path,
    }),
  });
  // Warm missing agent pairs in the background (boot never waits; usable probe results are left
  // alone). Must run after the engine exists so its asset subscription sees the whole lifecycle.
  for (const kind of ['claude-code', 'codex'] as const) {
    if (agentRuntimes[kind]?.status === 'available') continue;
    void assets
      .ensure(`agent:${kind}`)
      .catch((err) => {
        console.warn(
          `[linkcode/daemon] managed install failed for ${kind}: ${extractErrorMessage(err)}`,
        );
      })
      .then((installed) => {
        if (installed) {
          console.log(
            `[linkcode/daemon] managed runtime ready: ${installed.id}@${installed.version}`,
          );
        }
      });
  }
  await engine.start();
  // Runs before any listener binds, so `workspace.list` always includes the chat workspace by the
  // time a client can connect.
  await engine.ensureChatWorkspace(chatWorkspaceRoot());

  const servers: TransportServer[] = [];
  let stopUplink: () => void = noop;
  const stopAll = async (): Promise<void> => {
    stopUplink();
    await Promise.all(servers.map((server) => server.close()));
    hub.close();
    await engine.stop();
  };

  try {
    // Listeners hunt concurrently; a transient collision between two of our own hunts resolves
    // itself because listenWithPortHunt treats an occupant with our pid as "keep hunting".
    const bound: DaemonListenerInfo[] = await Promise.all(
      config.listeners.map(async (listener) => {
        const { server, url, port } = await listenWithPortHunt(listener, identity, previewRoutes);
        // Preview URLs carry the first bound port; every listener proxies the same table.
        previewRoutes.proxyPort ??= port;
        server.onConnection((conn) => {
          hub.addConnection(conn);
          conn.onClose(() => hub.removeConnection(conn));
        });
        servers.push(server);
        console.log(`[linkcode/daemon] listening on ${url} (${listener.type})`);
        return { type: listener.type, url };
      }),
    );
    writeRuntimeFile({ ...identity, listeners: bound });
    stopUplink = startHqUplink(hub);
  } catch (err) {
    if (err instanceof DaemonAlreadyRunningError) {
      console.error(`[linkcode/daemon] ${extractErrorMessage(err)}`);
      await stopAll();
      // See the findRunningDaemon branch above for why this must be an explicit exit.
      process.exit(DAEMON_EXIT_ALREADY_RUNNING);
    }
    throw err;
  }

  // foxts `once` prewarms (executes) by default; `false` defers it to the first real call.
  const shutdown = once((): void => {
    void (async () => {
      try {
        removeRuntimeFile();
        await stopAll();
      } catch (err) {
        console.error('[linkcode/daemon] error during shutdown:', err);
      } finally {
        process.exit(0);
      }
    })();
  }, false);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[linkcode/daemon] fatal:', err);
  process.exit(1);
});
