import type {
  Accounts,
  AgentEvent,
  AgentHistoryCapabilities,
  AgentHistoryId,
  AgentHistorySession,
  AgentInput,
  AgentKind,
  AgentRuntimes,
  AttachmentId,
  BlobId,
  ContentBlock,
  ConversationGraphTurn,
  ConversationReadItem,
  CustomMcpServer,
  CustomMcpServerPatchOp,
  CustomMcpServerPublic,
  EffortLevel,
  ManagedAssetId,
  ManagedAssetKey,
  ManagedAssetStatus,
  MessageId,
  PermissionOutcome,
  Plugin,
  PromptId,
  ProvidersConfig,
  QuestionOutcome,
  RunId,
  SessionId,
  SessionInfo,
  SessionResource,
  SessionResourceId,
  SessionStatus,
  StandaloneSkill,
  TerminalMetadata,
  TerminalReplayEvent,
  ToolCall,
  TurnId,
  TurnSubmitInput,
  UploadId,
  WireMessage,
  WirePayload,
  WorkspaceId,
  WorkspaceRecord,
  WorkspaceScript,
} from '@linkcode/schema';
import {
  AGENT_INPUT_CAPABILITIES,
  ATTACHMENT_UPLOAD_CHUNK_BYTES,
  AttachmentIdSchema,
  attachmentUri,
  blobIdFromSha256,
  declaredMimeTypeMatches,
  effectiveAttachmentCapability,
  managedAgentAssetId,
  managedAssetIdEquals,
  managedAssetKey,
  managedToolAssetId,
  normalizeCwdKey,
  SessionResourceIdSchema,
  textBlock,
  UploadIdSchema,
  userRowMessageId,
} from '@linkcode/schema';
import type { Transport } from '@linkcode/transport';
import { createWireMessage, pong } from '@linkcode/transport';
import { wait } from 'foxts/wait';
import { MOCK_COMMAND_CATALOG, mockCommandFixture } from './data/commands';
import { MOCK_WORKSPACE_FILES, mockFileFixture } from './data/files';
import { gitFixtureFor } from './data/git';
import { SEED_HISTORY } from './data/history';
import { createLongThreadScript } from './data/long-thread';
import { SEED_MODEL_CATALOGS } from './data/models';
import { SEED_PLUGIN_PROVIDER_STATUS, SEED_PLUGINS, SEED_STANDALONE_SKILLS } from './data/plugins';
import {
  CHUNK_LATENCY_MS,
  CONTROL_LATENCY_MS,
  FAIL_PROMPT,
  MOCK_REPLY,
  MOCK_USAGE_REPORT,
  REFUSE_MESSAGE,
  REFUSE_PROMPT,
  WORD_CHUNK_PATTERN,
} from './data/prompt';
import { mockScriptDeclarations } from './data/scripts';
import type { SeedSessionResource } from './data/sessions';
import { SEED_SESSIONS, SHOWCASE_TERMINAL_ID } from './data/sessions';
import {
  createShowcaseToolBursts,
  SHOWCASE_ACTIVITY_RUN_INTRO,
  SHOWCASE_ACTIVITY_RUN_NARRATION,
  SHOWCASE_ACTIVITY_RUN_THOUGHT,
  SHOWCASE_ARCHITECTURE_LINK,
  SHOWCASE_ARTIFACTS_CONTENT,
  SHOWCASE_COMMANDS_NARRATION,
  SHOWCASE_COMPACTION_HOLD_MS,
  SHOWCASE_COMPACTION_ID,
  SHOWCASE_COMPACTION_POST_TOKENS,
  SHOWCASE_COMPACTION_PRE_TOKENS,
  SHOWCASE_COMPACTION_SUMMARY,
  SHOWCASE_EMBEDDED_RESOURCE,
  SHOWCASE_ERROR_EVENT,
  SHOWCASE_EXPLORE_NARRATION,
  SHOWCASE_FILES_NARRATION,
  SHOWCASE_IMAGE,
  SHOWCASE_INTRO_CONTENT,
  SHOWCASE_MARKDOWN_CONTENT,
  SHOWCASE_PERMISSION_DENIED_CONTENT,
  SHOWCASE_PERMISSION_GRANTED_CONTENT,
  SHOWCASE_PERMISSIONS,
  SHOWCASE_PLAN,
  SHOWCASE_QUESTION,
  SHOWCASE_SCRIPT_START_DELAY_MS,
  SHOWCASE_SCRIPT_STEP_LATENCY_MS,
  SHOWCASE_STREAM_CHUNK_LATENCY_MS,
  SHOWCASE_STREAM_REPLY,
  SHOWCASE_STREAM_START_DELAY_MS,
  SHOWCASE_STREAM_THOUGHT_CONTENT,
  SHOWCASE_TERMINAL_EXIT_OUTPUT,
  SHOWCASE_TERMINAL_START_OUTPUT,
  SHOWCASE_THOUGHT_CONTENT,
  SHOWCASE_USER_CONTENT,
} from './data/showcase';

/** Pace of the mock download's staged `asset.progress` broadcasts. */
const ASSET_PROGRESS_LATENCY_MS = 400;

/** Provider truths the mock can reflect without probing a real install. Install-discovered model
 * defaults (Pi) stay absent; adapters without an effort axis (OpenCode/Pi) stay absent too. */
const MOCK_DEFAULT_MODELS: Readonly<Partial<Record<AgentKind, string>>> = {
  'claude-code': 'claude-opus-4-8',
  codex: 'gpt-5.5',
  'grok-build': 'grok-4.5',
};

const MOCK_DEFAULT_EFFORTS: Readonly<Partial<Record<AgentKind, EffortLevel>>> = {
  'claude-code': 'high',
  codex: 'high',
  'grok-build': 'high',
};

/** What each adapter class declares; grok-build declares nothing. */
const MOCK_HISTORY_CAPABILITIES: Readonly<Partial<Record<AgentKind, AgentHistoryCapabilities>>> = {
  'claude-code': { list: true, read: true, resume: true, forkAfterTurn: true, branch: true },
  codex: { list: true, read: true, resume: true, forkAfterTurn: true, branch: true },
  opencode: { list: true, read: true, resume: true, forkAfterTurn: false, branch: true },
  pi: { list: true, read: true, resume: true, forkAfterTurn: true, branch: true },
};

interface MockSession extends SessionInfo {
  /** Host-only replay state: keep it off `session.list` so the mock crosses the schema boundary. */
  model?: string;
  effort?: EffortLevel;
  /** Bumped by cancel/stop so an in-flight prompt turn knows to bail out. */
  epoch: number;
  /** The daemon's event-plane position: `eventEpoch` bumps per resume, `eventSeq` per frame. */
  eventEpoch: number;
  eventSeq: number;
  /** Every stamped frame ever emitted — the mock's stand-in for provider history, so a
   * `conversation.read` reproduces exactly what a client already had. */
  journal: MockJournalEntry[];
  /** The turn the next frames are attributed to; set from a turn's start until it settles. */
  runningTurnId?: TurnId;
  /** Every turn ever minted, any lineage; siblings share a parent and take ordinals in order. */
  graphTurns: MockTurn[];
  /** The host default view; moves on every submit, the way the daemon's does on dispatch. */
  activeLeafTurnId?: TurnId;
  graphRevision: number;
  showcase?: boolean;
  showcaseSeeded?: boolean;
  longThread?: boolean;
  longThreadSeeded?: boolean;
  terminalId?: string;
}

interface MockTurn {
  graph: ConversationGraphTurn;
  content: ContentBlock[];
  /** `conversation.read` user-row content; the live echo stays text-only. */
  readContent?: ContentBlock[];
}

type MockReplyOutcome = { state: 'completed' | 'cancelled' } | { state: 'failed'; message: string };

interface MockJournalEntry {
  epoch: number;
  seq: number;
  ts: number;
  turnId?: TurnId;
  event: AgentEvent;
}

interface PendingPermission {
  sessionId: SessionId;
  /** The pending snapshot the ask was raised for; the response re-emits it resolved. */
  toolCall: ToolCall;
}

interface MockTerminal {
  metadata: TerminalMetadata;
  seq: number;
  replay: TerminalReplayEvent[];
  attachments: Map<string, string>;
}

interface MockAttachmentUpload {
  uploadId: UploadId;
  declaredSha256: string;
  declaredSize: number;
  name: string;
  mimeType?: string;
  attachmentKind: string;
  received: number;
  bytes: Uint8Array;
  state: 'ready' | 'exists';
  attachmentId?: AttachmentId;
  blobId?: BlobId;
}

interface MockAttachmentBegin {
  uploadId: UploadId;
  chunkBytes: number;
  state: 'ready' | 'exists';
}

function createMockTerminal(
  terminalId: string,
  opts: {
    managed: boolean;
    cols?: number;
    rows?: number;
    cwd?: string;
    shell?: string;
    sessionId?: SessionId;
  },
): MockTerminal {
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;
  return {
    metadata: {
      terminalId,
      cols,
      rows,
      cwd: opts.cwd,
      shell: opts.shell,
      sessionId: opts.sessionId,
      managed: opts.managed,
      createdAt: Date.now(),
      controllerAttachmentId: null,
    },
    seq: 1,
    replay: [{ type: 'resize', seq: 1, cols, rows }],
    attachments: new Map(),
  };
}

interface PendingQuestion {
  sessionId: SessionId;
  /** The pending snapshot the ask was raised for; the response re-emits it resolved. */
  toolCall: ToolCall;
}

export class DevMockHost {
  private readonly sessions = new Map<SessionId, MockSession>();
  private readonly resources = new Map<SessionResourceId, SessionResource>();
  private readonly workspaces = new Map<WorkspaceId, WorkspaceRecord>();
  private providers: ProvidersConfig = {};
  private accounts: Accounts = [];
  /** Stored with full secrets like the daemon; config.get serves the masked projection. */
  private customMcpServers: CustomMcpServer[] = [];
  private readonly plugins: Plugin[] = structuredClone(SEED_PLUGINS);
  private readonly standaloneSkills: StandaloneSkill[] = structuredClone(SEED_STANDALONE_SKILLS);
  private readonly permissions = new Map<string, PendingPermission>();
  private readonly questions = new Map<string, PendingQuestion>();
  private history: AgentHistorySession[] = [];
  private readonly terminals = new Map<string, MockTerminal>();
  private readonly scripts = new Map<string, Map<string, WorkspaceScript>>();
  private sessionSeq = 0;
  private messageSeq = 0;
  private workspaceSeq = 0;
  private terminalSeq = 0;
  private resourceSeq = 0;
  private turnSeq = 0;
  /** Assets a mock `asset.ensure` has "installed"; list/runtime replies reflect it afterwards. */
  private readonly installedAssets = new Set<ManagedAssetKey>();
  private readonly cleanGitWorkspaces = new Set<string>();
  private readonly createdGitBranches = new Map<string, Set<string>>();
  private readonly attachmentUploads = new Map<string, MockAttachmentUpload>();
  private readonly attachmentBlobs = new Map<string, Uint8Array>();
  private readonly attachmentRecords = new Map<
    string,
    { blobId: BlobId; sizeBytes: number; name: string; mimeType: string; kind: string }
  >();
  private readonly attachmentBegins = new Map<string, MockAttachmentBegin>();
  /** The daemon's `isReachable` roots: sessions whose prompt or resource names the attachment. */
  private readonly attachmentSessions = new Map<AttachmentId, Set<SessionId>>();
  private uploadSeq = 0;
  private attachmentSeq = 0;

  constructor(private readonly transport: Transport) {
    this.terminals.set(
      SHOWCASE_TERMINAL_ID,
      createMockTerminal(SHOWCASE_TERMINAL_ID, { managed: true }),
    );
  }

  /**
   * Onboarding fixtures (CODE-112), one kind per state: claude-code missing (downloadable), codex
   * out-of-range (unverified-continue + paired-download), pi builtin, opencode absent (unevaluated).
   */
  private agentRuntimes(): AgentRuntimes {
    return {
      'claude-code': this.installedAssets.has(managedAssetKey(managedAgentAssetId('claude-code')))
        ? {
            status: 'available',
            source: 'managed',
            version: '2.1.179',
            path: '/mock/assets/agent/claude-code/0.3.179/claude',
          }
        : { status: 'missing' },
      codex: this.installedAssets.has(managedAssetKey(managedAgentAssetId('codex')))
        ? {
            status: 'available',
            source: 'managed',
            version: '0.140.0',
            path: '/mock/assets/agent/codex/0.140.0/codex',
          }
        : { status: 'out-of-range', source: 'detected', version: '0.99.0' },
      pi: { status: 'available', source: 'builtin' },
    };
  }

  private assetStatuses(): ManagedAssetStatus[] {
    return (
      [
        { id: managedAgentAssetId('claude-code'), wantedVersion: '0.3.179' },
        { id: managedAgentAssetId('codex'), wantedVersion: '0.140.0' },
        { id: managedToolAssetId('tectonic'), wantedVersion: '0.16.9' },
      ] as const
    ).map(({ id, wantedVersion }) => ({
      id,
      wantedVersion,
      installed: this.installedAssets.has(managedAssetKey(id))
        ? {
            id,
            version: wantedVersion,
            path: `/mock/assets/${id.kind}/${id.name}/${wantedVersion}/bin`,
          }
        : undefined,
    }));
  }

  /** Staged download: throttled progress → settled → correlated reply → runtime re-probe push. */
  private async ensureAsset(clientReqId: string, id: ManagedAssetId): Promise<void> {
    const totalBytes = 66 * 1_048_576;
    const fractions = [0.04, 0.19, 0.42, 0.68, 0.91];
    for (let i = 0, len = fractions.length; i < len; i++) {
      const fraction = fractions[i];
      this.send({
        kind: 'asset.progress',
        id,
        receivedBytes: Math.round(totalBytes * fraction),
        totalBytes,
      });
      // eslint-disable-next-line no-await-in-loop -- staged progress is deliberately sequential
      await wait(ASSET_PROGRESS_LATENCY_MS);
    }
    this.installedAssets.add(managedAssetKey(id));
    const status = this.assetStatuses().find((candidate) =>
      managedAssetIdEquals(candidate.id, id),
    ) ?? {
      id,
      wantedVersion: '0.0.0',
    };
    this.send({ kind: 'asset.settled', id, installed: status.installed });
    this.send({ kind: 'asset.ensured', replyTo: clientReqId, status });
    this.send({ kind: 'agent-runtime.changed', runtimes: this.agentRuntimes() });
  }

  private scriptsFor(cwd: string): Map<string, WorkspaceScript> {
    let scripts = this.scripts.get(cwd);
    if (!scripts) {
      scripts = new Map(mockScriptDeclarations().map((script) => [script.scriptName, script]));
      this.scripts.set(cwd, scripts);
    }
    return scripts;
  }

  start(): void {
    void this.transport.connect();
    this.transport.onMessage((msg) => {
      void this.handle(msg);
    });
    const now = Date.now();
    for (let i = 0, len = SEED_SESSIONS.length; i < len; i++) {
      const { ageMs, resources, workspaceKind, ...seed } = SEED_SESSIONS[i];
      const createdAt = now - ageMs;
      const session = this.addSession({ ...seed, createdAt, updatedAt: createdAt });
      this.seedResources(session.sessionId, now, resources ?? []);
      const workspace = this.touchWorkspace(seed.cwd, createdAt);
      if (workspaceKind) workspace.kind = workspaceKind;
    }
    this.history = SEED_HISTORY.map(({ ageMs, ...entry }) => ({
      ...entry,
      createdAt: now - ageMs,
      updatedAt: now - ageMs,
    }));
  }

  private async handle(msg: WireMessage): Promise<void> {
    const p = msg.payload;
    switch (p.kind) {
      case 'session.list':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'session.listed',
          replyTo: p.clientReqId,
          sessions: Array.from(this.sessions.values(), (session) => toSessionInfo(session)),
        });
        // Start after the list reply so the UI can subscribe before scripted frames arrive.
        this.startShowcase();
        this.seedLongThreads();
        break;
      case 'session.attach':
        this.attachSession(p.sessionId);
        break;
      case 'session.start':
        await wait(CONTROL_LATENCY_MS);
        this.startSession(
          p.clientReqId,
          p.opts.kind,
          p.opts.cwd,
          p.opts.model ?? undefined,
          p.opts.effort,
        );
        break;
      case 'session.resume':
        await wait(CONTROL_LATENCY_MS);
        this.resumeSession(p.clientReqId, p.sessionId);
        break;
      case 'session.stop':
        await wait(CONTROL_LATENCY_MS);
        this.stopSession(p.clientReqId, p.sessionId);
        break;
      case 'agent.input':
        await this.handleInput(p.clientReqId, p.sessionId, p.input);
        break;
      case 'turn.submit':
        await wait(CONTROL_LATENCY_MS);
        await this.submitTurn(p);
        break;
      case 'conversation.graph.get': {
        await wait(CONTROL_LATENCY_MS);
        const session = this.sessions.get(p.sessionId);
        if (!session) {
          this.sendFailure(p.clientReqId, `Unknown session: ${p.sessionId}`);
          break;
        }
        this.send({
          kind: 'conversation.graph.result',
          replyTo: p.clientReqId,
          sessionId: p.sessionId,
          graphRevision: session.graphRevision,
          ...(session.activeLeafTurnId !== undefined && {
            activeLeafTurnId: session.activeLeafTurnId,
          }),
          turns: session.graphTurns.map((turn) => structuredClone(turn.graph)),
        });
        break;
      }
      case 'conversation.read': {
        await wait(CONTROL_LATENCY_MS);
        const session = this.sessions.get(p.sessionId);
        if (!session) {
          this.sendFailure(p.clientReqId, `Unknown session: ${p.sessionId}`);
          break;
        }
        // Fail loudly on parameters the mock would silently ignore.
        if (p.cursor !== undefined || p.limit !== undefined) {
          this.sendFailure(p.clientReqId, 'Dev mock host does not support read paging yet.');
          break;
        }
        if (
          p.leafTurnId !== undefined &&
          !session.graphTurns.some((turn) => turn.graph.turnId === p.leafTurnId)
        ) {
          this.sendFailure(p.clientReqId, `Unknown turn: ${p.leafTurnId}`, { code: 'not_found' });
          break;
        }
        const leafTurnId = p.leafTurnId ?? session.activeLeafTurnId;
        this.send({
          kind: 'conversation.read.result',
          replyTo: p.clientReqId,
          sessionId: p.sessionId,
          graphRevision: session.graphRevision,
          ...(leafTurnId !== undefined && { leafTurnId }),
          watermark: { epoch: session.eventEpoch, seq: session.eventSeq },
          events: readMockProjection(session, leafTurnId),
        });
        break;
      }
      case 'resource.list':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'resource.listed',
          replyTo: p.clientReqId,
          resources: [...this.resources.values()].filter(
            (resource) => resource.sessionId === p.sessionId,
          ),
        });
        break;
      case 'resource.source.upload':
        await this.uploadSource(p);
        break;
      case 'resource.remove':
        await wait(CONTROL_LATENCY_MS);
        this.removeResource(p.clientReqId, p.resourceId);
        break;
      case 'resource.host':
        await wait(CONTROL_LATENCY_MS);
        this.hostResource(p.clientReqId, p.resourceId);
        break;
      case 'attachment.upload.begin':
        await wait(CONTROL_LATENCY_MS);
        this.beginAttachmentUpload(p);
        break;
      case 'attachment.upload.chunk':
        this.chunkAttachmentUpload(p);
        break;
      case 'attachment.upload.commit':
        await wait(CONTROL_LATENCY_MS);
        await this.commitAttachmentUpload(p);
        break;
      case 'attachment.upload.abort':
        await wait(CONTROL_LATENCY_MS);
        this.abortAttachmentUpload(p);
        break;
      case 'attachment.read':
        await wait(CONTROL_LATENCY_MS);
        this.readAttachment(p);
        break;
      case 'config.get':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'config.get.result',
          replyTo: p.clientReqId,
          providers: this.providers,
          accounts: this.accounts,
          customMcpServers: this.customMcpServers.map((entry) => maskCustomMcpServer(entry)),
        });
        break;
      case 'agent-runtime.list':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'agent-runtime.listed',
          replyTo: p.clientReqId,
          runtimes: this.agentRuntimes(),
        });
        break;
      case 'asset.list':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'asset.listed',
          replyTo: p.clientReqId,
          assets: this.assetStatuses(),
        });
        break;
      case 'asset.ensure':
        await this.ensureAsset(p.clientReqId, p.id);
        break;
      case 'config.set':
        await wait(CONTROL_LATENCY_MS);
        if (p.providers !== undefined) this.providers = structuredClone(p.providers);
        if (p.accounts !== undefined) this.accounts = structuredClone(p.accounts);
        if (p.customMcpServers !== undefined) {
          this.customMcpServers = applyCustomMcpPatches(this.customMcpServers, p.customMcpServers);
        }
        this.sendSuccess(p.clientReqId);
        break;
      case 'plugin.list.get':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'plugin.list.result',
          replyTo: p.clientReqId,
          plugins: this.plugins,
          standaloneSkills: this.standaloneSkills,
          providerStatus: SEED_PLUGIN_PROVIDER_STATUS,
        });
        break;
      case 'skill.set-enabled': {
        await wait(CONTROL_LATENCY_MS);
        const skill = this.standaloneSkills.find(
          (entry) => entry.provider === p.provider && entry.id === p.skillId,
        );
        if (!skill?.toggleable) {
          this.sendFailure(p.clientReqId, 'skill management is not supported');
          break;
        }
        skill.enabled = p.enabled;
        this.send({ kind: 'skill.updated', replyTo: p.clientReqId, skill });
        break;
      }
      case 'plugin.set-enabled': {
        await wait(CONTROL_LATENCY_MS);
        const plugin = this.plugins.find(
          (entry) => entry.provider === p.provider && entry.id === p.id,
        );
        if (!plugin?.managementCapabilities.enable) {
          this.sendFailure(p.clientReqId, 'plugin management is not supported');
          break;
        }
        for (let i = 0, len = plugin.installations.length; i < len; i++) {
          const installation = plugin.installations[i];
          if (p.scope === undefined || installation.scope === p.scope) {
            installation.enabled = p.enabled;
          }
        }
        this.send({ kind: 'plugin.updated', replyTo: p.clientReqId, plugin });
        break;
      }
      case 'plugin.install':
      case 'plugin.uninstall': {
        await wait(CONTROL_LATENCY_MS);
        const installing = p.kind === 'plugin.install';
        const plugin = this.plugins.find(
          (entry) => entry.provider === p.provider && entry.id === p.id,
        );
        const capable = installing
          ? plugin?.managementCapabilities.install
          : plugin?.managementCapabilities.uninstall;
        if (!plugin || !capable) {
          this.sendFailure(p.clientReqId, `${p.provider}: plugin ${p.kind} is not supported`);
          break;
        }
        // Mirrors the daemon: the marketplace entry survives an uninstall with no installations.
        plugin.installations = installing
          ? [{ enabled: true, version: plugin.version, scope: 'user' }]
          : [];
        this.send({
          kind: 'plugin.updated',
          replyTo: p.clientReqId,
          plugin,
          ...(installing &&
            plugin.components.some((component) => component.kind === 'app') && {
              pendingAuthApps: ['Mock Connector'],
            }),
        });
        break;
      }
      case 'workspace.list':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'workspace.listed',
          replyTo: p.clientReqId,
          workspaces: this.listWorkspaces(),
        });
        break;
      case 'workspace.register':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'workspace.registered',
          replyTo: p.clientReqId,
          record: this.touchWorkspace(p.cwd, Date.now(), p.name),
        });
        break;
      case 'workspace.update':
        await wait(CONTROL_LATENCY_MS);
        this.updateWorkspace(p.clientReqId, p.workspaceId, p.name);
        break;
      case 'workspace.archive':
        await wait(CONTROL_LATENCY_MS);
        this.archiveWorkspace(p.workspaceId);
        this.sendSuccess(p.clientReqId);
        break;
      case 'git.status.get':
        await wait(CONTROL_LATENCY_MS);
        {
          const status = gitFixtureFor(p.cwd).status;
          const clean = this.cleanGitWorkspaces.has(normalizeCwdKey(p.cwd));
          this.send({
            kind: 'git.status.get.result',
            replyTo: p.clientReqId,
            status: clean && status.isRepo ? { ...status, dirtyFileCount: 0 } : status,
          });
        }
        break;
      case 'git.branch.list':
        await wait(CONTROL_LATENCY_MS);
        {
          const branchList = gitFixtureFor(p.cwd).branchList;
          const created = this.createdGitBranches.get(normalizeCwdKey(p.cwd)) ?? [];
          this.send({
            kind: 'git.branch.list.result',
            replyTo: p.clientReqId,
            branchList: branchList.isRepo
              ? {
                  ...branchList,
                  branches: [
                    ...branchList.branches,
                    ...Array.from(created, (name) => ({
                      name,
                      isCurrent: false,
                      lastCommitAt: Date.now(),
                    })),
                  ],
                }
              : branchList,
          });
        }
        break;
      case 'git.branch.switch.check': {
        await wait(CONTROL_LATENCY_MS);
        const status = gitFixtureFor(p.cwd).status;
        const hasConflicts =
          status.isRepo &&
          status.dirtyFileCount > 0 &&
          status.branch !== p.branch &&
          !this.createdGitBranches.get(normalizeCwdKey(p.cwd))?.has(p.branch) &&
          !this.cleanGitWorkspaces.has(normalizeCwdKey(p.cwd));
        this.send({
          kind: 'git.branch.switch.check.result',
          replyTo: p.clientReqId,
          check: hasConflicts
            ? {
                status: 'conflict',
                files: [
                  { path: 'packages/client/workbench/src/mock.ts', additions: 12, deletions: 4 },
                  { path: 'packages/presentation/ui/src/shell.tsx', additions: 3, deletions: 1 },
                ],
              }
            : { status: 'ready' },
        });
        break;
      }
      case 'git.branch.create':
        await wait(CONTROL_LATENCY_MS);
        {
          const cwd = normalizeCwdKey(p.cwd);
          const branches = this.createdGitBranches.get(cwd) ?? new Set<string>();
          branches.add(p.branch);
          this.createdGitBranches.set(cwd, branches);
        }
        this.sendSuccess(p.clientReqId);
        break;
      case 'git.commit':
        await wait(CONTROL_LATENCY_MS);
        this.cleanGitWorkspaces.add(normalizeCwdKey(p.cwd));
        this.sendSuccess(p.clientReqId);
        break;
      case 'git.pr_status.get':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'git.pr_status.get.result',
          replyTo: p.clientReqId,
          prStatus: gitFixtureFor(p.cwd).prStatus,
        });
        break;
      case 'git.diff.get':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'git.diff.get.result',
          replyTo: p.clientReqId,
          diff: gitFixtureFor(p.cwd).diff,
        });
        break;
      case 'file.read': {
        await wait(CONTROL_LATENCY_MS);
        const file = mockFileFixture(p.cwd, p.path);
        if (file) this.send({ kind: 'file.read.result', replyTo: p.clientReqId, file });
        else this.sendFailure(p.clientReqId, `Mock host has no fixture for ${p.path}`);
        break;
      }
      case 'file.list':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'file.list.result',
          replyTo: p.clientReqId,
          files: [...MOCK_WORKSPACE_FILES],
        });
        break;
      case 'script.list': {
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'script.listed',
          replyTo: p.clientReqId,
          scripts: [...this.scriptsFor(p.cwd).values()],
        });
        break;
      }
      case 'script.start': {
        await wait(CONTROL_LATENCY_MS);
        const script = this.scriptsFor(p.cwd).get(p.scriptName);
        if (!script || script.lifecycle === 'running') {
          this.sendFailure(p.clientReqId, `Cannot start mock script: ${p.scriptName}`);
          break;
        }
        this.sendSuccess(p.clientReqId);
        script.lifecycle = 'running';
        script.terminalId = SHOWCASE_TERMINAL_ID;
        this.send({ kind: 'script.status', cwd: p.cwd, script: { ...script } });
        if (script.type === 'service') {
          await wait(CONTROL_LATENCY_MS);
          script.health = 'healthy';
          this.send({ kind: 'script.status', cwd: p.cwd, script: { ...script } });
        }
        break;
      }
      case 'artifact.host': {
        await wait(CONTROL_LATENCY_MS);
        // No reverse proxy in mock mode: a renderer-local blob URL stands in for the
        // daemon's per-artifact origin (the desktop CSP allows frame-src blob:).
        const url = URL.createObjectURL(new Blob([p.content], { type: p.mimeType }));
        this.send({
          kind: 'artifact.hosted',
          replyTo: p.clientReqId,
          artifact: { hash: `mock-${this.messageSeq++}`, hostname: 'mock.localhost', url },
        });
        break;
      }
      case 'artifact.revoke': {
        this.sendSuccess(p.clientReqId);
        break;
      }
      case 'file.host': {
        await wait(CONTROL_LATENCY_MS);
        // No reverse proxy in mock mode: the requested path can't be streamed, so echo a
        // placeholder origin. Mock video preview isn't wired — this only keeps the request
        // from hanging.
        this.send({
          kind: 'file.hosted',
          replyTo: p.clientReqId,
          hosted: {
            hash: `mock-${this.messageSeq++}`,
            hostname: 'file--mock.localhost',
            url: `http://file--mock.localhost/${p.path}`,
          },
        });
        break;
      }
      case 'script.stop': {
        await wait(CONTROL_LATENCY_MS);
        const script = this.scriptsFor(p.cwd).get(p.scriptName);
        if (script?.lifecycle !== 'running') {
          this.sendFailure(p.clientReqId, `Mock script not running: ${p.scriptName}`);
          break;
        }
        this.sendSuccess(p.clientReqId);
        script.lifecycle = 'stopped';
        script.health = 'unknown';
        script.exitCode = 0;
        this.send({ kind: 'script.status', cwd: p.cwd, script: { ...script } });
        break;
      }
      case 'session.import':
        await wait(CONTROL_LATENCY_MS);
        this.importSession(p.clientReqId, p.agentKind, p.historyId);
        break;
      case 'history.list':
        await wait(CONTROL_LATENCY_MS);
        this.send({
          kind: 'history.listed',
          replyTo: p.clientReqId,
          result: { sessions: this.listHistory(p.agentKind, p.opts?.cwd) },
        });
        break;
      case 'history.read':
      case 'history.resume':
        // Fail loudly for unmocked surfaces so correlated SDK calls reject instead of hanging forever.
        this.sendFailure(p.clientReqId, 'Dev mock host does not support history yet.');
        break;
      case 'terminal.list':
        this.send({
          kind: 'terminal.listed',
          replyTo: p.clientReqId,
          terminals: Array.from(this.terminals.values(), (terminal) => terminal.metadata),
        });
        break;
      case 'terminal.open':
        await wait(CONTROL_LATENCY_MS);
        this.openTerminal(p);
        break;
      case 'terminal.attach':
        this.attachTerminal(p);
        break;
      case 'terminal.detach':
        this.detachTerminal(p.terminalId, p.attachmentId, p.attachmentSecret);
        break;
      case 'terminal.input': {
        // Echo PTY: no shell behind it, keystrokes come straight back; Enter draws a fresh prompt.
        const terminal = this.authorizedTerminal(p.terminalId, p.attachmentId, p.attachmentSecret);
        if (terminal?.metadata.controllerAttachmentId === p.attachmentId) {
          this.writeTerminal(p.terminalId, p.data.replaceAll('\r', '\r\n$ '));
        }
        break;
      }
      case 'terminal.resize': {
        const terminal = this.authorizedTerminal(p.terminalId, p.attachmentId, p.attachmentSecret);
        if (terminal?.metadata.controllerAttachmentId === p.attachmentId) {
          terminal.metadata = { ...terminal.metadata, cols: p.cols, rows: p.rows };
          this.resizeTerminal(p.terminalId, p.cols, p.rows);
        }
        break;
      }
      case 'terminal.close': {
        const terminal = this.authorizedTerminal(p.terminalId, p.attachmentId, p.attachmentSecret);
        if (
          terminal?.metadata.controllerAttachmentId === p.attachmentId &&
          this.terminals.delete(p.terminalId)
        ) {
          this.send({ kind: 'terminal.exit', terminalId: p.terminalId, exitCode: 0 });
        }
        break;
      }
      case 'ping':
        this.send(pong());
        break;
      default:
        break;
    }
  }

  private addSession(
    init: Omit<
      MockSession,
      | 'sessionId'
      | 'origin'
      | 'epoch'
      | 'eventEpoch'
      | 'eventSeq'
      | 'journal'
      | 'status'
      | 'graphTurns'
      | 'activeLeafTurnId'
      | 'graphRevision'
    > & {
      status: SessionStatus;
      origin?: SessionInfo['origin'];
    },
  ): MockSession {
    const { origin, ...rest } = init;
    const session: MockSession = {
      ...rest,
      model:
        rest.model ?? SEED_MODEL_CATALOGS[rest.kind]?.[0]?.id ?? MOCK_DEFAULT_MODELS[rest.kind],
      effort:
        MOCK_DEFAULT_EFFORTS[rest.kind] === undefined
          ? undefined
          : (rest.effort ?? MOCK_DEFAULT_EFFORTS[rest.kind]),
      sessionId: this.nextSessionId(),
      origin: origin ?? { type: 'created' },
      epoch: 0,
      eventEpoch: 0,
      eventSeq: 0,
      journal: [],
      graphTurns: [],
      graphRevision: 0,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  private seedResources(
    sessionId: SessionId,
    now: number,
    seeds: readonly SeedSessionResource[],
  ): void {
    for (let i = 0, len = seeds.length; i < len; i++) {
      const { ageMs, ...seed } = seeds[i];
      const timestamp = now - ageMs;
      const resource: SessionResource = {
        ...seed,
        resourceId: this.nextResourceId(),
        sessionId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.resources.set(resource.resourceId, resource);
    }
  }

  private async uploadSource(
    payload: Extract<WirePayload, { kind: 'resource.source.upload' }>,
  ): Promise<void> {
    if (!this.sessions.has(payload.sessionId)) {
      await wait(CONTROL_LATENCY_MS);
      this.sendFailure(payload.clientReqId, `Unknown session: ${payload.sessionId}`);
      return;
    }
    const resourceId = this.nextResourceId();
    const now = Date.now();
    const processing: SessionResource = {
      resourceId,
      sessionId: payload.sessionId,
      direction: 'source',
      name: payload.name,
      kind: payload.mimeType?.startsWith('image/') ? 'image' : 'file',
      status: 'processing',
      locator: { type: 'managed-file', path: `/mock/resources/${resourceId}` },
      mimeType: payload.mimeType,
      createdAt: now,
      updatedAt: now,
    };
    this.resources.set(resourceId, processing);
    this.send({ kind: 'resource.changed', resource: processing });
    await wait(CONTROL_LATENCY_MS);
    // Resource bytes land in the attachment store on the daemon, which is what roots them for
    // `attachment.read`; a resource with no attachment id would be unreadable through the wire.
    const attachmentId = await this.publishResourceAttachment(payload);
    this.rootAttachment(payload.sessionId, attachmentId);
    const ready: SessionResource = {
      ...processing,
      status: 'ready',
      attachmentId,
      updatedAt: Date.now(),
    };
    this.resources.set(resourceId, ready);
    this.send({ kind: 'resource.changed', resource: ready });
    this.send({ kind: 'resource.uploaded', replyTo: payload.clientReqId, resource: ready });
  }

  private removeResource(replyTo: string, resourceId: SessionResourceId): void {
    const resource = this.resources.get(resourceId);
    if (resource) {
      this.resources.delete(resourceId);
      this.send({ kind: 'resource.removed', resourceId, sessionId: resource.sessionId });
    }
    this.sendSuccess(replyTo);
  }

  private hostResource(replyTo: string, resourceId: SessionResourceId): void {
    const resource = this.resources.get(resourceId);
    if (resource?.status !== 'ready') {
      this.sendFailure(replyTo, `Ready mock resource not found: ${resourceId}`);
      return;
    }
    const url =
      resource.locator.type === 'url'
        ? resource.locator.url
        : URL.createObjectURL(
            new Blob([`Mock resource: ${resource.name}\n`], {
              type: resource.mimeType ?? 'text/plain',
            }),
          );
    this.send({ kind: 'resource.hosted', replyTo, hosted: { url } });
  }

  private listWorkspaces(): WorkspaceRecord[] {
    return [...this.workspaces.values()].sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  }

  private touchWorkspace(cwd: string, now: number, name?: string): WorkspaceRecord {
    const key = normalizeCwdKey(cwd);
    for (const workspace of this.workspaces.values()) {
      if (normalizeCwdKey(workspace.cwd) !== key) continue;
      workspace.lastUsedAt = Math.max(workspace.lastUsedAt, now);
      return workspace;
    }
    const workspace: WorkspaceRecord = {
      workspaceId: this.nextWorkspaceId(),
      cwd,
      name: name ?? lastPathSegment(cwd),
      createdAt: now,
      lastUsedAt: now,
    };
    this.workspaces.set(workspace.workspaceId, workspace);
    return workspace;
  }

  private updateWorkspace(replyTo: string, workspaceId: WorkspaceId, name: string): void {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) {
      this.sendFailure(replyTo, `Unknown workspace: ${workspaceId}`);
      return;
    }
    workspace.name = name;
    this.sendSuccess(replyTo);
  }

  private archiveWorkspace(workspaceId: WorkspaceId): void {
    this.workspaces.delete(workspaceId);
  }

  private startSession(
    replyTo: string,
    kind: MockSession['kind'],
    cwd: string,
    model: string | undefined,
    effort: EffortLevel | undefined,
  ): void {
    const now = Date.now();
    const session = this.addSession({
      kind,
      cwd,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      model,
      effort,
    });
    // Parity with the engine: starting a session registers/freshens its directory's workspace.
    this.touchWorkspace(cwd, now);
    const { sessionId } = session;
    this.emit(sessionId, { type: 'status', status: 'starting' });
    this.emit(sessionId, { type: 'current-mode-update', currentModeId: 'mock' });
    this.emitDirectiveAdvertisement(sessionId);
    const catalog = SEED_MODEL_CATALOGS[kind];
    if (catalog) {
      this.emit(sessionId, { type: 'available-models-update', models: catalog });
    }
    // Reflect a concrete model/effort like a real adapter, so the composer shows them not placeholders.
    if (session.model) this.emit(sessionId, { type: 'model-update', model: session.model });
    if (session.effort) this.emit(sessionId, { type: 'effort-update', effort: session.effort });
    this.emit(sessionId, { type: 'status', status: 'idle' });
    this.send({ kind: 'session.started', replyTo, sessionId });
  }

  private listHistory(agentKind: AgentKind, cwd: string | undefined): AgentHistorySession[] {
    const cwdKey = cwd === undefined ? null : normalizeCwdKey(cwd);
    return this.history.filter(
      (entry) =>
        entry.kind === agentKind &&
        (cwdKey === null || (entry.cwd !== undefined && normalizeCwdKey(entry.cwd) === cwdKey)),
    );
  }

  /** Mint a cold (stopped, resumable) session from a canned history entry, like the engine's import. */
  private importSession(replyTo: string, agentKind: AgentKind, historyId: AgentHistoryId): void {
    const entry = this.history.find(
      (item) => item.kind === agentKind && item.historyId === historyId,
    );
    if (!entry) {
      this.sendFailure(replyTo, `Unknown history session: ${historyId}`);
      return;
    }
    const now = Date.now();
    const origin = { type: 'imported', historyId, importedAt: now } as const;
    const session = this.addSession({
      kind: entry.kind,
      cwd: entry.cwd ?? '/mock/imported',
      title: entry.title,
      status: 'stopped',
      createdAt: entry.createdAt ?? now,
      updatedAt: now,
      origin,
    });
    this.send({
      kind: 'session.imported',
      replyTo,
      record: {
        sessionId: session.sessionId,
        kind: session.kind,
        cwd: session.cwd,
        title: session.title,
        origin,
        createdAt: session.createdAt,
        updatedAt: now,
        runs: [],
        graphRevision: 0,
        eventEpoch: 0,
      },
    });
  }

  private openTerminal(p: Extract<WirePayload, { kind: 'terminal.open' }>): void {
    this.terminalSeq += 1;
    const terminalId = `mock-term-${Date.now().toString(36)}-${this.terminalSeq.toString(36)}`;
    const terminal = createMockTerminal(terminalId, { ...p.opts, managed: false });
    terminal.attachments.set(p.attachmentId, p.attachmentSecret);
    terminal.metadata = { ...terminal.metadata, controllerAttachmentId: p.attachmentId };
    this.terminals.set(terminalId, terminal);
    terminal.seq += 1;
    terminal.replay.push({
      type: 'write',
      seq: terminal.seq,
      data: `mock echo terminal — no shell attached (cwd: ${p.opts.cwd ?? '/'})\r\n$ `,
    });
    this.send({
      kind: 'terminal.opened',
      replyTo: p.clientReqId,
      terminal: terminal.metadata,
      replay: [...terminal.replay],
      cutoffSeq: terminal.seq,
      truncated: false,
    });
  }

  private attachTerminal(p: Extract<WirePayload, { kind: 'terminal.attach' }>): void {
    const terminal = this.terminals.get(p.terminalId);
    if (!terminal) {
      this.sendFailure(p.clientReqId, `Unknown terminal: ${p.terminalId}`);
      return;
    }
    const secret = terminal.attachments.get(p.attachmentId);
    if (secret !== undefined && secret !== p.attachmentSecret) {
      this.sendFailure(p.clientReqId, 'Invalid terminal attachment credentials');
      return;
    }
    if (p.mode === 'control' && terminal.metadata.managed) {
      this.sendFailure(p.clientReqId, 'Managed terminals are view-only');
      return;
    }
    terminal.attachments.set(p.attachmentId, p.attachmentSecret);
    if (p.mode === 'control') {
      terminal.metadata = {
        ...terminal.metadata,
        controllerAttachmentId: p.attachmentId,
      };
    }
    this.send({
      kind: 'terminal.attached',
      replyTo: p.clientReqId,
      terminal: terminal.metadata,
      replay: [...terminal.replay],
      cutoffSeq: terminal.seq,
      truncated: false,
    });
    if (p.mode === 'control') {
      this.send({
        kind: 'terminal.controller.changed',
        terminalId: p.terminalId,
        controllerAttachmentId: p.attachmentId,
      });
    }
  }

  private detachTerminal(terminalId: string, attachmentId: string, attachmentSecret: string): void {
    const terminal = this.authorizedTerminal(terminalId, attachmentId, attachmentSecret);
    if (!terminal) return;
    terminal.attachments.delete(attachmentId);
    if (terminal.metadata.controllerAttachmentId !== attachmentId) return;
    terminal.metadata = { ...terminal.metadata, controllerAttachmentId: null };
    this.send({
      kind: 'terminal.controller.changed',
      terminalId,
      controllerAttachmentId: null,
    });
  }

  private authorizedTerminal(
    terminalId: string,
    attachmentId: string,
    attachmentSecret: string,
  ): MockTerminal | undefined {
    const terminal = this.terminals.get(terminalId);
    return terminal?.attachments.get(attachmentId) === attachmentSecret ? terminal : undefined;
  }

  private writeTerminal(terminalId: string, data: string): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    terminal.seq += 1;
    const event: TerminalReplayEvent = { type: 'write', seq: terminal.seq, data };
    terminal.replay.push(event);
    this.send({ kind: 'terminal.output', terminalId, seq: event.seq, data });
  }

  private resizeTerminal(terminalId: string, cols: number, rows: number): void {
    const terminal = this.terminals.get(terminalId);
    if (!terminal) return;
    terminal.seq += 1;
    const event: TerminalReplayEvent = { type: 'resize', seq: terminal.seq, cols, rows };
    terminal.replay.push(event);
    this.send({ kind: 'terminal.resized', terminalId, seq: event.seq, cols, rows });
  }

  private resumeSession(replyTo: string, sessionId: SessionId): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendFailure(replyTo, `Unknown session: ${sessionId}`);
      return;
    }
    // Parity with the engine: only cold sessions can be resumed.
    if (session.status !== 'stopped') {
      this.sendFailure(replyTo, `Session is already running: ${sessionId}`);
      return;
    }
    // A relaunch mints under a new epoch, like the daemon's run launch.
    session.eventEpoch += 1;
    session.eventSeq = 0;
    session.status = 'idle';
    this.attachSession(sessionId);
    this.send({ kind: 'session.started', replyTo, sessionId });
  }

  /** Replay the live state a late subscriber cannot recover from session history. */
  private attachSession(sessionId: SessionId): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.emit(sessionId, { type: 'status', status: session.status });
    if (session.model) this.emit(sessionId, { type: 'model-update', model: session.model });
    if (session.effort) this.emit(sessionId, { type: 'effort-update', effort: session.effort });
    this.emitDirectiveAdvertisement(sessionId);
    const catalog = SEED_MODEL_CATALOGS[session.kind];
    if (catalog) this.emit(sessionId, { type: 'available-models-update', models: catalog });
  }

  /** The composer's directive inputs: what the session accepts (`/` + `$`) and its `/` catalog. */
  private emitDirectiveAdvertisement(sessionId: SessionId): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const capabilities = AGENT_INPUT_CAPABILITIES[session.kind];
    this.emit(sessionId, {
      type: 'capabilities-update',
      capabilities,
    });
    if (capabilities.slashCommands) {
      this.emit(sessionId, { type: 'available-commands-update', commands: MOCK_COMMAND_CATALOG });
    }
  }

  private stopSession(replyTo: string, sessionId: SessionId): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendFailure(replyTo, `Unknown session: ${sessionId}`);
      return;
    }
    session.epoch += 1;
    this.drainSessionPrompts(sessionId);
    session.status = 'stopped';
    this.emit(sessionId, { type: 'status', status: 'stopped' });
    this.sendSuccess(replyTo);
  }

  private async handleInput(
    replyTo: string,
    sessionId: SessionId,
    input: AgentInput,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendFailure(replyTo, `Unknown session: ${sessionId}`);
      return;
    }
    // Parity with the engine, which only routes input to live sessions.
    if (session.status === 'stopped') {
      this.sendFailure(replyTo, `Session is stopped, resume it first: ${sessionId}`);
      return;
    }

    switch (input.type) {
      case 'prompt':
        await this.prompt(replyTo, session, input.content);
        break;
      case 'cancel':
        session.epoch += 1;
        this.drainSessionPrompts(sessionId);
        session.status = 'idle';
        this.emit(sessionId, { type: 'stop', stopReason: 'cancelled' });
        this.emit(sessionId, { type: 'status', status: 'idle' });
        this.sendSuccess(replyTo);
        break;
      case 'set-model':
        session.model = input.model;
        this.emit(sessionId, { type: 'model-update', model: input.model });
        this.sendSuccess(replyTo);
        break;
      case 'set-effort':
        session.effort = input.effort;
        this.emit(sessionId, { type: 'effort-update', effort: input.effort });
        this.sendSuccess(replyTo);
        break;
      case 'set-mode':
        this.emit(sessionId, { type: 'current-mode-update', currentModeId: input.modeId });
        this.sendSuccess(replyTo);
        break;
      case 'permission-response':
        this.respondPermission(replyTo, sessionId, input.requestId, input.outcome);
        break;
      case 'command':
        this.invokeCommand(replyTo, session, input.name, input.arguments);
        break;
      case 'shell-command': {
        const content = [textBlock(`$ ${input.command}`)];
        const turn = this.beginTurn(session, content, input);
        this.settleTurn(session, turn, 'completed');
        this.sendSuccess(replyTo);
        break;
      }
      case 'question-response':
        this.respondQuestion(replyTo, sessionId, input.requestId, input.outcome);
        break;
      default:
        this.sendFailure(replyTo, 'Dev mock host does not support that input yet.');
        break;
    }
  }

  private invokeCommand(
    replyTo: string,
    session: MockSession,
    name: string,
    args: string | undefined,
  ): void {
    const fixture = mockCommandFixture(name);
    if (!fixture) {
      const message = `Unknown mock slash command: /${name}`;
      this.emit(session.sessionId, {
        type: 'error',
        message,
        code: 'input_rejected',
        recoverable: true,
      });
      this.sendFailure(replyTo, message, { reportedInConversation: true });
      return;
    }

    const content = [textBlock(`/${name}${args ? ` ${args}` : ''}`)];
    const turn = this.beginTurn(session, content, {
      type: 'command',
      name,
      ...(args !== undefined && { arguments: args }),
    });
    session.status = 'running';
    this.emit(session.sessionId, { type: 'status', status: 'running' });
    if (fixture.reply === undefined) {
      this.emit(session.sessionId, { type: 'usage-report', report: MOCK_USAGE_REPORT });
    } else {
      this.emit(session.sessionId, {
        type: 'agent-message-chunk',
        messageId: this.nextMessageId(`mock-${fixture.command.name}`),
        content: textBlock(fixture.reply),
      });
      this.emit(session.sessionId, { type: 'stop', stopReason: 'end_turn' });
    }
    session.status = 'idle';
    this.emit(session.sessionId, { type: 'status', status: 'idle' });
    this.settleTurn(session, turn, 'completed');
    this.sendSuccess(replyTo);
  }

  /** Appends a completed turn to the mock graph and streams the scripted reply — the daemon's
   * submit saga reduced to showcase parity. */
  private async submitTurn(p: Extract<WirePayload, { kind: 'turn.submit' }>): Promise<void> {
    const session = this.sessions.get(p.sessionId);
    if (!session) {
      this.sendFailure(p.clientReqId, `Unknown session: ${p.sessionId}`);
      return;
    }
    if (session.status === 'stopped') {
      this.sendFailure(p.clientReqId, `Session is stopped, resume it first: ${p.sessionId}`);
      return;
    }
    if (session.status === 'running') {
      this.sendFailure(p.clientReqId, `Session is busy: ${p.sessionId}`, { code: 'busy' });
      return;
    }
    // Explicit-parent submits carry the daemon's admit rules in its order: the parent must exist
    // and have completed, then the revision must match. `null` starts a new root lineage.
    let parentTurnId: TurnId | null | undefined;
    if (p.parentTurnId !== undefined) {
      if (p.parentTurnId !== null) {
        const parent = session.graphTurns.find((turn) => turn.graph.turnId === p.parentTurnId);
        if (parent === undefined) {
          this.sendFailure(p.clientReqId, `Unknown turn: ${p.parentTurnId}`, {
            code: 'not_found',
          });
          return;
        }
        if (parent.graph.state !== 'completed') {
          this.sendFailure(p.clientReqId, 'The parent turn has not completed', {
            code: 'conflict',
          });
          return;
        }
      }
      if (p.expectedGraphRevision !== session.graphRevision) {
        this.sendFailure(p.clientReqId, 'The conversation graph has moved', { code: 'conflict' });
        return;
      }
      parentTurnId = p.parentTurnId;
    }
    if (p.input.type === 'prompt') {
      const blocks = p.input.blocks;
      // Admission mirrors the daemon's typed refusals so a composer bug cannot hide behind the mock.
      const capability = effectiveAttachmentCapability(session.kind);
      for (let i = 0, len = blocks.length; i < len; i++) {
        const block = blocks[i];
        if (block.type !== 'attachment_ref') continue;
        const record = this.attachmentRecords.get(block.attachmentId);
        if (record === undefined) {
          this.sendFailure(p.clientReqId, 'Unknown attachment', { code: 'unsupported_attachment' });
          return;
        }
        if (capability?.kinds[record.kind === 'image' ? 'image' : 'file'] === undefined) {
          this.sendFailure(p.clientReqId, 'This agent does not accept attachments of this kind', {
            code: 'unsupported_attachment',
          });
          return;
        }
      }
      for (let i = 0, len = blocks.length; i < len; i++) {
        const block = blocks[i];
        if (block.type === 'attachment_ref') this.rootAttachment(p.sessionId, block.attachmentId);
      }
    }
    const content = turnSubmitContent(p.input);
    if (p.input.type === 'prompt' && promptText(content).toLowerCase() === REFUSE_PROMPT) {
      const refused = this.refuseTurn(session, content, parentTurnId);
      refused.readContent = this.projectTurnSubmit(p.input);
      this.sendFailure(p.clientReqId, REFUSE_MESSAGE, { code: 'operation_failed' });
      return;
    }
    const turn = this.beginTurn(
      session,
      content,
      p.input.type === 'prompt' ? undefined : p.input,
      parentTurnId,
    );
    turn.readContent = this.projectTurnSubmit(p.input);
    this.send({ kind: 'turn.submitted', replyTo: p.clientReqId, turnId: turn.graph.turnId });
    if (p.input.type === 'prompt') {
      const result = await this.streamMockReply(session, content);
      this.settleTurn(session, turn, result.state);
      return;
    }
    // Command/shell turns just echo — the mock has no directive execution behind turn.submit.
    this.settleTurn(session, turn, 'completed');
  }

  /** Every device refetches the tree: a node it did not have moves the revision; a settle keeps
   * it — the badge is what changed (the daemon's `announceGraph`). */
  private announceGraph(session: MockSession, gainedNode: boolean): void {
    if (gainedNode) session.graphRevision += 1;
    this.send({
      kind: 'conversation.graph.changed',
      sessionId: session.sessionId,
      graphRevision: session.graphRevision,
      ...(session.activeLeafTurnId !== undefined && { activeLeafTurnId: session.activeLeafTurnId }),
    });
  }

  private settleTurn(
    session: MockSession,
    turn: MockTurn,
    state: 'completed' | 'failed' | 'cancelled',
  ): void {
    turn.graph.state = state;
    if (session.runningTurnId === turn.graph.turnId) session.runningTurnId = undefined;
    this.announceGraph(session, false);
  }

  /** Persist a graph turn the way the daemon does before dispatch: a plain send lands under the
   * active leaf, an explicit parent lands a sibling (or a root). */
  private mintTurn(
    session: MockSession,
    content: ContentBlock[],
    input: Exclude<TurnSubmitInput, { type: 'prompt' }> | undefined,
    parentTurnId: TurnId | null | undefined,
    state: 'running' | 'failed',
  ): MockTurn {
    this.turnSeq += 1;
    const id = this.turnSeq.toString(36);
    const turnId = `turn-mock-${id}` as TurnId;
    const parent = parentTurnId === undefined ? (session.activeLeafTurnId ?? null) : parentTurnId;
    const siblingOrdinal =
      session.graphTurns.filter((turn) => turn.graph.parentTurnId === parent).length + 1;
    const turn: MockTurn = {
      graph: {
        turnId,
        sessionId: session.sessionId,
        parentTurnId: parent,
        siblingOrdinal,
        input: input ?? { type: 'prompt', promptId: `prompt-mock-${id}` as PromptId },
        runId: `run-mock-${id}` as RunId,
        state,
        createdAt: Date.now(),
        inputSummary: promptText(content).slice(0, 140),
      },
      content,
    };
    session.graphTurns.push(turn);
    return turn;
  }

  /** Mint the graph turn a turn-starting input persists on the daemon (legacy inputs included)
   * and point the frames that follow at it: the default leaf moves as the turn commits running. */
  private beginTurn(
    session: MockSession,
    content: ContentBlock[],
    input?: Exclude<TurnSubmitInput, { type: 'prompt' }>,
    parentTurnId?: TurnId | null,
  ): MockTurn {
    const turn = this.mintTurn(session, content, input, parentTurnId, 'running');
    const { turnId } = turn.graph;
    session.activeLeafTurnId = turnId;
    session.runningTurnId = turnId;
    // Echo before graph.changed so a subscribed projection store sees the new leaf row and
    // treats a plain send as continuation, matching the engine dispatcher.
    this.emit(session.sessionId, {
      type: 'user-message',
      messageId: userRowMessageId(turnId),
      content,
    });
    this.announceGraph(session, true);
    return turn;
  }

  /** A prompt the provider refuses before it runs — the daemon's `resolveFailed` shape: the tree
   * gains a failed node and announces it, the default leaf stays, and nothing is echoed live. */
  private refuseTurn(
    session: MockSession,
    content: ContentBlock[],
    parentTurnId: TurnId | null | undefined,
  ): MockTurn {
    const turn = this.mintTurn(session, content, undefined, parentTurnId, 'failed');
    turn.readContent = content;
    this.announceGraph(session, true);
    return turn;
  }

  private async prompt(
    replyTo: string,
    session: MockSession,
    content: ContentBlock[],
  ): Promise<void> {
    // The daemon sniffs before it stores; a mislabeled inline image is refused before any echo.
    for (let i = 0, len = content.length; i < len; i++) {
      const block = content[i];
      if (block.type !== 'image') continue;
      if (!declaredMimeTypeMatches(block.mimeType, mockBase64ToBytes(block.data).subarray(0, 16))) {
        this.sendFailure(replyTo, `File contents are not ${block.mimeType}`, {
          code: 'invalid_request',
        });
        return;
      }
    }
    if (promptText(content).toLowerCase() === REFUSE_PROMPT) {
      this.refuseTurn(session, content, undefined);
      this.sendFailure(replyTo, REFUSE_MESSAGE, { code: 'operation_failed' });
      return;
    }
    const turn = this.beginTurn(session, content);
    turn.readContent = await this.ingestInlineImages(session.sessionId, content);
    const result = await this.streamMockReply(session, content);
    this.settleTurn(session, turn, result.state);
    if (result.state === 'failed') {
      this.sendFailure(replyTo, result.message, { reportedInConversation: true });
    } else {
      this.sendSuccess(replyTo);
    }
  }

  private async streamMockReply(
    session: MockSession,
    content: ContentBlock[],
  ): Promise<MockReplyOutcome> {
    const text = promptText(content);
    if (text && !session.title) session.title = text.slice(0, 80);
    session.status = 'running';
    this.emit(session.sessionId, { type: 'status', status: 'running' });

    // Cancel/stop bump the session epoch; a stale epoch means this turn was cancelled and the
    // cancel handler already emitted the terminal events — just ack the prompt and bail.
    const epoch = session.epoch;
    const cancelledAfter = async (ms: number): Promise<boolean> => {
      await wait(ms);
      return session.epoch !== epoch;
    };

    if (await cancelledAfter(200)) return { state: 'cancelled' };
    const thoughtId = this.nextMessageId('mock-thought');
    this.emit(session.sessionId, {
      type: 'agent-thought-chunk',
      messageId: thoughtId,
      content: textBlock('Reading the mocked request.'),
    });

    if (text.toLowerCase() === FAIL_PROMPT) {
      if (await cancelledAfter(200)) return { state: 'cancelled' };
      const message = `Mock failure requested via the "${FAIL_PROMPT}" prompt.`;
      this.emit(session.sessionId, {
        type: 'error',
        message,
        code: 'input_rejected',
        recoverable: true,
      });
      session.status = 'idle';
      this.emit(session.sessionId, { type: 'status', status: 'idle' });
      return { state: 'failed', message };
    }

    const messageId = this.nextMessageId('mock-message');
    const reply = `${MOCK_REPLY}\n\nModel: ${session.model ?? 'mock-default'}\nYou said: ${text || '(empty prompt)'}`;
    const chunks = reply.match(WORD_CHUNK_PATTERN);
    if (chunks != null) {
      for (let i = 0, len = chunks.length; i < len; i++) {
        // eslint-disable-next-line no-await-in-loop -- word-by-word streaming: chunks are paced sequentially by design.
        if (await cancelledAfter(CHUNK_LATENCY_MS)) return { state: 'cancelled' };
        this.emit(session.sessionId, {
          type: 'agent-message-chunk',
          messageId,
          content: textBlock(chunks[i]),
        });
      }
    }
    this.emit(session.sessionId, {
      type: 'token-usage',
      usage: {
        inputTokens: Math.max(1, Math.ceil(text.length / 4)),
        outputTokens: 32,
      },
    });
    this.emit(session.sessionId, { type: 'stop', stopReason: 'end_turn' });
    session.status = 'idle';
    this.emit(session.sessionId, { type: 'status', status: 'idle' });
    return { state: 'completed' };
  }

  /** Emitted in one burst, not streamed: this transcript exists to be long, not to look live. */
  private seedLongThreads(): void {
    for (const session of this.sessions.values()) {
      if (!session.longThread || session.longThreadSeeded) continue;
      session.longThreadSeeded = true;
      const script = createLongThreadScript((slug) => this.nextMessageId(slug));
      for (let i = 0, len = script.length; i < len; i++) {
        const event = script[i];
        this.emit(session.sessionId, event);
      }
    }
  }

  private startShowcase(): void {
    for (const session of this.sessions.values()) {
      if (!session.showcase) continue;
      if (session.showcaseSeeded) continue;
      session.showcaseSeeded = true;
      void this.runShowcase(session);
    }
  }

  private async runShowcase(session: MockSession): Promise<void> {
    session.status = 'running';
    const epoch = session.epoch;
    await wait(SHOWCASE_SCRIPT_START_DELAY_MS);
    if (!isRunningTurn(session, epoch)) return;
    if (!(await this.emitShowcaseConversation(session, epoch))) return;
    await this.streamShowcaseReply(session, epoch);
  }

  private async emitShowcaseConversation(session: MockSession, epoch: number): Promise<boolean> {
    const introId = this.nextMessageId('mock-showcase-intro');
    const resourceId = this.nextMessageId('mock-showcase-resource');
    const terminalId = session.terminalId ?? SHOWCASE_TERMINAL_ID;
    const bursts = createShowcaseToolBursts(terminalId);
    const toolEvents = (toolCalls: readonly ToolCall[]): AgentEvent[] =>
      toolCalls.map((toolCall) => ({ type: 'tool-call', toolCall }));

    const script: AgentEvent[] = [
      { type: 'status', status: 'running' },
      { type: 'current-mode-update', currentModeId: 'mock-showcase' },
      {
        type: 'user-message',
        messageId: this.nextMessageId('mock-showcase-user'),
        content: SHOWCASE_USER_CONTENT,
      },
      {
        type: 'agent-thought-chunk',
        messageId: this.nextMessageId('mock-showcase-thought'),
        content: SHOWCASE_THOUGHT_CONTENT,
      },
      { type: 'plan', plan: SHOWCASE_PLAN },
      {
        type: 'agent-message-chunk',
        messageId: introId,
        content: SHOWCASE_INTRO_CONTENT,
      },
      {
        type: 'agent-message-chunk',
        messageId: introId,
        content: SHOWCASE_ARCHITECTURE_LINK,
      },
      {
        type: 'agent-message-chunk',
        messageId: resourceId,
        content: SHOWCASE_EMBEDDED_RESOURCE,
      },
      {
        type: 'agent-message-chunk',
        messageId: this.nextMessageId('mock-showcase-image'),
        content: SHOWCASE_IMAGE,
      },
      {
        type: 'agent-message-chunk',
        messageId: this.nextMessageId('mock-showcase-markdown'),
        content: SHOWCASE_MARKDOWN_CONTENT,
      },
      {
        type: 'agent-message-chunk',
        messageId: this.nextMessageId('mock-showcase-artifacts'),
        content: SHOWCASE_ARTIFACTS_CONTENT,
      },
      ...toolEvents(bursts.explore),
      {
        type: 'agent-message-chunk',
        messageId: this.nextMessageId('mock-showcase-explore-note'),
        content: SHOWCASE_EXPLORE_NARRATION,
      },
      ...toolEvents(bursts.files),
      {
        type: 'agent-message-chunk',
        messageId: this.nextMessageId('mock-showcase-files-note'),
        content: SHOWCASE_FILES_NARRATION,
      },
      ...toolEvents(bursts.commands),
      {
        type: 'agent-message-chunk',
        messageId: this.nextMessageId('mock-showcase-commands-note'),
        content: SHOWCASE_COMMANDS_NARRATION,
      },
      ...toolEvents(bursts.wrapUp),
      {
        type: 'agent-message-chunk',
        messageId: this.nextMessageId('mock-activity-run-intro'),
        content: SHOWCASE_ACTIVITY_RUN_INTRO,
      },
      {
        type: 'agent-thought-chunk',
        messageId: this.nextMessageId('mock-activity-run-thought'),
        content: SHOWCASE_ACTIVITY_RUN_THOUGHT,
      },
      ...toolEvents(bursts.activityRun.beforeNarration),
      {
        type: 'agent-message-chunk',
        messageId: this.nextMessageId('mock-activity-run-note'),
        content: SHOWCASE_ACTIVITY_RUN_NARRATION,
      },
      ...toolEvents([bursts.activityRun.singleton]),
      ...toolEvents([bursts.activityRun.taskBoundary]),
      ...toolEvents(bursts.activityRun.afterTask),
    ];

    for (let i = 0, len = script.length; i < len; i++) {
      // eslint-disable-next-line no-await-in-loop -- the showcase script emits step by step on purpose.
      if (!(await waitForShowcaseStep(session, epoch))) return false;
      this.emit(session.sessionId, script[i]);
    }
    if (!(await waitForShowcaseStep(session, epoch))) return false;
    this.writeTerminal(terminalId, SHOWCASE_TERMINAL_START_OUTPUT);
    this.questions.set(SHOWCASE_QUESTION.requestId, {
      sessionId: session.sessionId,
      toolCall: SHOWCASE_QUESTION.toolCall,
    });
    if (!(await this.emitShowcaseEvent(session, epoch, SHOWCASE_QUESTION))) return false;
    for (let i = 0, len = SHOWCASE_PERMISSIONS.length; i < len; i++) {
      const permission = SHOWCASE_PERMISSIONS[i];
      this.permissions.set(permission.requestId, {
        sessionId: session.sessionId,
        toolCall: permission.toolCall,
      });
      // The tool snapshot is the timeline authority; the following ask only references it.
      // eslint-disable-next-line no-await-in-loop -- the showcase script emits step by step on purpose.
      const announced = await this.emitShowcaseEvent(session, epoch, {
        type: 'tool-call',
        toolCall: permission.toolCall,
      });
      if (!announced) return false;
      // eslint-disable-next-line no-await-in-loop -- the showcase script emits step by step on purpose.
      const emitted = await this.emitShowcaseEvent(session, epoch, {
        type: 'permission-request',
        requestId: permission.requestId,
        title: permission.title,
        description: permission.description,
        subject: permission.subject,
        options: permission.options,
      });
      if (!emitted) return false;
    }
    return this.emitShowcaseEvent(session, epoch, SHOWCASE_ERROR_EVENT);
  }

  private async emitShowcaseEvent(
    session: MockSession,
    epoch: number,
    event: AgentEvent,
  ): Promise<boolean> {
    if (!(await waitForShowcaseStep(session, epoch))) return false;
    this.emit(session.sessionId, event);
    return true;
  }

  private async streamShowcaseReply(session: MockSession, epoch: number): Promise<void> {
    const terminalId = session.terminalId ?? SHOWCASE_TERMINAL_ID;
    const thoughtId = this.nextMessageId('mock-showcase-stream-thought');
    const messageId = this.nextMessageId('mock-showcase-stream');
    await wait(SHOWCASE_STREAM_START_DELAY_MS);
    if (!isRunningTurn(session, epoch)) return;

    // One compaction across its whole lifecycle: the live "compacting…" row holds briefly, then
    // the completed re-emit merges over it (same compactionId) as the tokens+summary divider.
    this.emit(session.sessionId, {
      type: 'compaction',
      compactionId: SHOWCASE_COMPACTION_ID,
      status: 'in_progress',
      trigger: 'auto',
    });
    await wait(SHOWCASE_COMPACTION_HOLD_MS);
    if (!isRunningTurn(session, epoch)) return;
    this.emit(session.sessionId, {
      type: 'compaction',
      compactionId: SHOWCASE_COMPACTION_ID,
      status: 'completed',
      trigger: 'auto',
      preTokens: SHOWCASE_COMPACTION_PRE_TOKENS,
      postTokens: SHOWCASE_COMPACTION_POST_TOKENS,
      summary: SHOWCASE_COMPACTION_SUMMARY,
    });

    this.emit(session.sessionId, {
      type: 'agent-thought-chunk',
      messageId: thoughtId,
      content: SHOWCASE_STREAM_THOUGHT_CONTENT,
    });

    const streamChunks = SHOWCASE_STREAM_REPLY.match(WORD_CHUNK_PATTERN);
    if (streamChunks != null) {
      for (let i = 0, len = streamChunks.length; i < len; i++) {
        // eslint-disable-next-line no-await-in-loop -- word-by-word streaming: chunks are paced sequentially by design.
        await wait(SHOWCASE_STREAM_CHUNK_LATENCY_MS);
        if (!isRunningTurn(session, epoch)) return;
        this.emit(session.sessionId, {
          type: 'agent-message-chunk',
          messageId,
          content: textBlock(streamChunks[i]),
        });
      }
    }
    this.writeTerminal(terminalId, SHOWCASE_TERMINAL_EXIT_OUTPUT);
    this.emit(session.sessionId, {
      type: 'token-usage',
      usage: { inputTokens: 148, outputTokens: 96, totalCostUsd: 0 },
    });
    // A real agent turn stays in flight while a prompt awaits its reply. Poll instead of
    // coordinating with the responders so the turn lifecycle stays in this one method.
    while (this.hasPendingPrompt(session.sessionId)) {
      // eslint-disable-next-line no-await-in-loop -- deliberate poll while awaiting prompt replies.
      await wait(200);
      if (!isRunningTurn(session, epoch)) return;
    }
    this.emit(session.sessionId, { type: 'stop', stopReason: 'end_turn' });
    session.status = 'idle';
    this.emit(session.sessionId, { type: 'status', status: 'idle' });
  }

  private hasPendingPrompt(sessionId: SessionId): boolean {
    for (const pending of this.questions.values()) {
      if (pending.sessionId === sessionId) return true;
    }
    for (const pending of this.permissions.values()) {
      if (pending.sessionId === sessionId) return true;
    }
    return false;
  }

  private drainSessionPrompts(sessionId: SessionId): void {
    for (const [requestId, pending] of this.permissions) {
      if (pending.sessionId !== sessionId) continue;
      this.permissions.delete(requestId);
      const outcome: PermissionOutcome = { outcome: 'cancelled' };
      this.emit(sessionId, {
        type: 'permission-resolved',
        requestId,
        outcome,
        source: 'session',
      });
      this.emitToolSnapshot(sessionId, {
        ...pending.toolCall,
        status: 'failed',
        rawOutput: { outcome },
      });
    }
    for (const [requestId, pending] of this.questions) {
      if (pending.sessionId !== sessionId) continue;
      this.questions.delete(requestId);
      const outcome: QuestionOutcome = { outcome: 'cancelled' };
      this.emit(sessionId, {
        type: 'question-resolved',
        requestId,
        outcome,
        source: 'session',
      });
      this.emitToolSnapshot(sessionId, {
        ...pending.toolCall,
        status: 'failed',
        rawOutput: { outcome },
      });
    }
  }

  private respondPermission(
    replyTo: string,
    sessionId: SessionId,
    requestId: string,
    outcome: PermissionOutcome,
  ): void {
    const pending = this.permissions.get(requestId);
    if (pending?.sessionId !== sessionId) {
      this.sendFailure(replyTo, `Unknown permission request: ${requestId}`);
      return;
    }
    this.permissions.delete(requestId);
    this.emit(sessionId, {
      type: 'permission-resolved',
      requestId,
      outcome,
      source: 'user',
    });
    const allowed = outcome.outcome === 'selected' && outcome.optionId.startsWith('allow');
    this.emitToolSnapshot(sessionId, {
      ...pending.toolCall,
      status: allowed ? 'completed' : 'failed',
      content: [
        ...pending.toolCall.content,
        {
          type: 'content',
          content: allowed
            ? SHOWCASE_PERMISSION_GRANTED_CONTENT
            : SHOWCASE_PERMISSION_DENIED_CONTENT,
        },
      ],
      rawOutput: { outcome },
    });
    this.sendSuccess(replyTo);
  }

  private respondQuestion(
    replyTo: string,
    sessionId: SessionId,
    requestId: string,
    outcome: QuestionOutcome,
  ): void {
    const pending = this.questions.get(requestId);
    if (pending?.sessionId !== sessionId) {
      this.sendFailure(replyTo, `Unknown question request: ${requestId}`);
      return;
    }
    this.questions.delete(requestId);
    this.emit(sessionId, {
      type: 'question-resolved',
      requestId,
      outcome,
      source: 'user',
    });
    this.emitToolSnapshot(sessionId, {
      ...pending.toolCall,
      status: outcome.outcome === 'answered' ? 'completed' : 'failed',
      rawOutput: { outcome },
    });
    this.sendSuccess(replyTo);
  }

  private emitToolSnapshot(sessionId: SessionId, toolCall: ToolCall): void {
    this.emit(sessionId, { type: 'tool-call', toolCall });
  }

  /** The mock's stamped exit: every frame takes the session's next `(epoch, seq)` position, its
   * running turn, and a journal entry — wire stream ≡ journal, as on the daemon. */
  private emit(sessionId: SessionId, event: AgentEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.send({ kind: 'agent.event', sessionId, event });
      return;
    }
    session.eventSeq += 1;
    const entry: MockJournalEntry = {
      epoch: session.eventEpoch,
      seq: session.eventSeq,
      ts: Date.now(),
      ...(session.runningTurnId !== undefined && { turnId: session.runningTurnId }),
      event,
    };
    session.journal.push(entry);
    this.send({
      kind: 'agent.event',
      sessionId,
      epoch: entry.epoch,
      seq: entry.seq,
      ...(entry.turnId !== undefined && { turnId: entry.turnId }),
      event,
    });
  }

  private beginAttachmentUpload(
    payload: Extract<WirePayload, { kind: 'attachment.upload.begin' }>,
  ): void {
    if (payload.operationId !== undefined) {
      const replayed = this.attachmentBegins.get(payload.operationId);
      if (replayed) {
        // The daemon's rule: one operation id names one begin, so other declared fields are refused.
        const upload = this.attachmentUploads.get(replayed.uploadId);
        if (
          upload?.declaredSha256 !== payload.declaredSha256 ||
          upload.declaredSize !== payload.declaredSize ||
          upload.name !== payload.name ||
          upload.mimeType !== payload.mimeType ||
          upload.attachmentKind !== payload.attachmentKind
        ) {
          this.sendFailure(payload.clientReqId, 'The operation id belongs to another upload', {
            code: 'invalid_request',
          });
          return;
        }
        this.send({
          kind: 'attachment.upload.begun',
          replyTo: payload.clientReqId,
          ...replayed,
        });
        return;
      }
    }
    const existing = this.attachmentBlobs.get(payload.declaredSha256);
    const state = existing?.byteLength === payload.declaredSize ? 'exists' : 'ready';
    this.uploadSeq += 1;
    const uploadId = UploadIdSchema.parse(`upl-mock-${this.uploadSeq}`);
    const bytes =
      existing !== undefined && state === 'exists'
        ? existing
        : new Uint8Array(payload.declaredSize);
    this.attachmentUploads.set(uploadId, {
      uploadId,
      declaredSha256: payload.declaredSha256,
      declaredSize: payload.declaredSize,
      name: payload.name,
      mimeType: payload.mimeType,
      attachmentKind: payload.attachmentKind,
      received: state === 'exists' ? payload.declaredSize : 0,
      bytes,
      state,
      blobId: state === 'exists' ? blobIdFromSha256(payload.declaredSha256) : undefined,
    });
    const begun: MockAttachmentBegin = {
      uploadId,
      chunkBytes: ATTACHMENT_UPLOAD_CHUNK_BYTES,
      state,
    };
    if (payload.operationId !== undefined) this.attachmentBegins.set(payload.operationId, begun);
    this.send({ kind: 'attachment.upload.begun', replyTo: payload.clientReqId, ...begun });
  }

  private chunkAttachmentUpload(
    payload: Extract<WirePayload, { kind: 'attachment.upload.chunk' }>,
  ): void {
    const upload = this.attachmentUploads.get(payload.uploadId);
    if (!upload) {
      this.sendFailure(payload.clientReqId, 'Upload not found', { code: 'not_found' });
      return;
    }
    if (upload.state === 'exists') {
      this.sendFailure(payload.clientReqId, 'Blob already stored; commit without chunks', {
        code: 'invalid_request',
      });
      return;
    }
    if (payload.offset !== upload.received) {
      this.sendFailure(
        payload.clientReqId,
        `Expected offset ${upload.received}, got ${payload.offset}`,
        { code: 'invalid_request' },
      );
      return;
    }
    let chunk: Uint8Array;
    try {
      chunk = mockBase64ToBytes(payload.data);
    } catch {
      this.sendFailure(payload.clientReqId, 'Chunk data is not valid base64', {
        code: 'invalid_request',
      });
      return;
    }
    if (upload.received + chunk.byteLength > upload.declaredSize) {
      this.sendFailure(payload.clientReqId, 'Chunk exceeds the declared size', {
        code: 'invalid_request',
      });
      return;
    }
    upload.bytes.set(chunk, payload.offset);
    upload.received += chunk.byteLength;
    this.send({
      kind: 'attachment.upload.chunk.acked',
      replyTo: payload.clientReqId,
      uploadId: payload.uploadId,
      receivedBytes: upload.received,
    });
  }

  private async commitAttachmentUpload(
    payload: Extract<WirePayload, { kind: 'attachment.upload.commit' }>,
  ): Promise<void> {
    const upload = this.attachmentUploads.get(payload.uploadId);
    if (!upload) {
      this.sendFailure(payload.clientReqId, 'Upload not found', { code: 'not_found' });
      return;
    }
    if (upload.attachmentId !== undefined && upload.blobId !== undefined) {
      this.send({
        kind: 'attachment.upload.committed',
        replyTo: payload.clientReqId,
        attachmentId: upload.attachmentId,
        blobId: upload.blobId,
      });
      return;
    }
    if (upload.state === 'ready' && upload.received !== upload.declaredSize) {
      this.sendFailure(
        payload.clientReqId,
        `Uploaded ${upload.received} bytes, declared ${upload.declaredSize}`,
        { code: 'invalid_request' },
      );
      return;
    }
    // Engine order: size, then declared MIME vs bytes, then SHA-256 — a rejected commit must
    // leave no blob behind.
    const declaredMime = upload.mimeType ?? 'application/octet-stream';
    if (!declaredMimeTypeMatches(declaredMime, upload.bytes.subarray(0, 16))) {
      this.sendFailure(payload.clientReqId, `File contents are not ${declaredMime}`, {
        code: 'invalid_request',
      });
      return;
    }
    if (upload.state === 'ready') {
      const digest = await mockSha256Hex(upload.bytes);
      if (digest !== upload.declaredSha256) {
        this.sendFailure(payload.clientReqId, 'Uploaded bytes do not match the declared SHA-256', {
          code: 'invalid_request',
        });
        return;
      }
      this.attachmentBlobs.set(upload.declaredSha256, upload.bytes);
    }
    this.attachmentSeq += 1;
    const attachmentId = AttachmentIdSchema.parse(`att-mock-${this.attachmentSeq}`);
    const blobId = blobIdFromSha256(upload.declaredSha256);
    upload.attachmentId = attachmentId;
    upload.blobId = blobId;
    this.attachmentRecords.set(attachmentId, {
      blobId,
      sizeBytes: upload.declaredSize,
      name: upload.name,
      mimeType: upload.mimeType ?? 'application/octet-stream',
      kind: upload.attachmentKind,
    });
    this.forgetAttachmentBegins(payload.uploadId);
    this.send({
      kind: 'attachment.upload.committed',
      replyTo: payload.clientReqId,
      attachmentId,
      blobId,
    });
  }

  private abortAttachmentUpload(
    payload: Extract<WirePayload, { kind: 'attachment.upload.abort' }>,
  ): void {
    if (!this.attachmentUploads.has(payload.uploadId)) {
      this.sendFailure(payload.clientReqId, 'Upload not found', { code: 'not_found' });
      return;
    }
    this.attachmentUploads.delete(payload.uploadId);
    this.forgetAttachmentBegins(payload.uploadId);
    this.sendSuccess(payload.clientReqId);
  }

  /** The daemon's `forget`: a replay dies with the upload it names — committed or aborted — or a
   * retried operationId resolves to a dead or already-committed id instead of a fresh begin. */
  private forgetAttachmentBegins(uploadId: string): void {
    for (const [operationId, begun] of this.attachmentBegins) {
      if (begun.uploadId === uploadId) this.attachmentBegins.delete(operationId);
    }
  }

  private publishResourceAttachment(
    payload: Extract<WirePayload, { kind: 'resource.source.upload' }>,
  ): Promise<AttachmentId> {
    return this.storeMockBytes(mockBase64ToBytes(payload.data), {
      name: payload.name,
      mimeType: payload.mimeType,
      kind: payload.mimeType?.startsWith('image/') ? 'image' : 'file',
    });
  }

  /** Bytes the mock already holds become one record, the way the daemon's ingest does. */
  private async storeMockBytes(
    bytes: Uint8Array,
    record: { name: string; mimeType?: string; kind: string },
  ): Promise<AttachmentId> {
    const digest = await mockSha256Hex(bytes);
    this.attachmentBlobs.set(digest, bytes);
    this.attachmentSeq += 1;
    const attachmentId = AttachmentIdSchema.parse(`att-mock-${this.attachmentSeq}`);
    this.attachmentRecords.set(attachmentId, {
      blobId: blobIdFromSha256(digest),
      sizeBytes: bytes.byteLength,
      name: record.name,
      mimeType: record.mimeType ?? 'application/octet-stream',
      kind: record.kind,
    });
    return attachmentId;
  }

  /** The daemon stores a legacy prompt's inline images and projects refs on read; the echo keeps
   * the image for old clients. `undefined` when the prompt is text-only (the echo is the row). */
  private ingestInlineImages(
    sessionId: SessionId,
    content: ContentBlock[],
  ): Promise<ContentBlock[] | undefined> {
    if (!content.some((block) => block.type === 'image')) return Promise.resolve(undefined);
    return Promise.all(
      content.map(async (block) => {
        if (block.type !== 'image') return block;
        const attachmentId = await this.storeMockBytes(mockBase64ToBytes(block.data), {
          name: block.name ?? 'image',
          mimeType: block.mimeType,
          kind: 'image',
        });
        this.rootAttachment(sessionId, attachmentId);
        return this.attachmentLink(attachmentId);
      }),
    );
  }

  private attachmentLink(attachmentId: AttachmentId): ContentBlock {
    const record = this.attachmentRecords.get(attachmentId);
    return {
      type: 'resource_link',
      uri: attachmentUri(attachmentId),
      name: record?.name ?? attachmentId,
      ...(record !== undefined && {
        mimeType: record.mimeType,
        size: record.sizeBytes,
        description: record.kind,
      }),
    };
  }

  /** Durable `conversation.read` row: refs become `attachment:` links, never bytes. */
  private projectTurnSubmit(input: TurnSubmitInput): ContentBlock[] {
    if (input.type !== 'prompt') return turnSubmitContent(input);
    return input.blocks.map((block) =>
      block.type === 'text' ? textBlock(block.text) : this.attachmentLink(block.attachmentId),
    );
  }

  /** Root an attachment in a session, the way persisting a prompt or a resource does on the daemon. */
  private rootAttachment(sessionId: SessionId, attachmentId: AttachmentId): void {
    const rooted = this.attachmentSessions.get(attachmentId) ?? new Set<SessionId>();
    rooted.add(sessionId);
    this.attachmentSessions.set(attachmentId, rooted);
  }

  private readAttachment(payload: Extract<WirePayload, { kind: 'attachment.read' }>): void {
    if (!this.attachmentSessions.get(payload.attachmentId)?.has(payload.sessionId)) {
      this.sendFailure(payload.clientReqId, 'Attachment not found', { code: 'not_found' });
      return;
    }
    const record = this.attachmentRecords.get(payload.attachmentId);
    if (!record) {
      this.sendFailure(payload.clientReqId, 'Attachment not found', { code: 'not_found' });
      return;
    }
    const hex = record.blobId.slice('sha256:'.length);
    const bytes = this.attachmentBlobs.get(hex);
    if (!bytes) {
      this.sendFailure(payload.clientReqId, 'Attachment bytes are missing', { code: 'not_found' });
      return;
    }
    if (payload.offset > bytes.byteLength) {
      this.sendFailure(payload.clientReqId, 'Read offset is past the end of the attachment', {
        code: 'invalid_request',
      });
      return;
    }
    const slice = bytes.subarray(payload.offset, payload.offset + payload.length);
    this.send({
      kind: 'attachment.read.result',
      replyTo: payload.clientReqId,
      sessionId: payload.sessionId,
      attachmentId: payload.attachmentId,
      blobId: record.blobId,
      offset: payload.offset,
      data: mockBytesToBase64(slice),
      sizeBytes: bytes.byteLength,
      eof: payload.offset + slice.byteLength >= bytes.byteLength,
    });
  }

  private send(payload: WirePayload): void {
    this.transport.send(createWireMessage(payload));
  }

  private sendSuccess(replyTo: string): void {
    this.send({ kind: 'request.succeeded', replyTo });
  }

  private sendFailure(
    replyTo: string,
    message: string,
    reporting: { reportedInConversation?: true; code?: string } = {},
  ): void {
    this.send({ kind: 'request.failed', replyTo, message, ...reporting });
  }

  private nextSessionId(): SessionId {
    this.sessionSeq += 1;
    return `mock-sess-${Date.now().toString(36)}-${this.sessionSeq.toString(36)}` as SessionId;
  }

  private nextMessageId(prefix: string): MessageId {
    this.messageSeq += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.messageSeq.toString(36)}` as MessageId;
  }

  private nextWorkspaceId(): WorkspaceId {
    this.workspaceSeq += 1;
    return `mock-ws-${Date.now().toString(36)}-${this.workspaceSeq.toString(36)}` as WorkspaceId;
  }

  private nextResourceId(): SessionResourceId {
    this.resourceSeq += 1;
    return SessionResourceIdSchema.parse(
      `mock-resource-${Date.now().toString(36)}-${this.resourceSeq.toString(36)}`,
    );
  }
}

function projectMockReadEvent(session: MockSession, entry: MockJournalEntry): AgentEvent {
  const { event } = entry;
  if (event.type !== 'user-message' || entry.turnId === undefined) return event;
  for (let i = 0, len = session.graphTurns.length; i < len; i++) {
    const turn = session.graphTurns[i];
    if (turn.graph.turnId !== entry.turnId || turn.readContent === undefined) continue;
    return { ...event, content: turn.readContent };
  }
  return event;
}

function turnSubmitContent(input: TurnSubmitInput): ContentBlock[] {
  switch (input.type) {
    case 'prompt':
      return input.blocks.flatMap((block) =>
        block.type === 'text' ? [textBlock(block.text)] : [],
      );
    case 'command':
      return [
        textBlock(`/${input.name}${input.arguments === undefined ? '' : ` ${input.arguments}`}`),
      ];
    case 'shell-command':
      return [textBlock(`$ ${input.command}`)];
    default:
      return [];
  }
}

function promptText(content: readonly ContentBlock[]): string {
  return content
    .reduce((text, block) => {
      if (block.type !== 'text') return text;
      return text ? `${text}\n${block.text}` : block.text;
    }, '')
    .trim();
}

/** The turns on the root→leaf path, the way the daemon reads one lineage of the tree. */
function pathTurnIds(session: MockSession, leafTurnId: TurnId | undefined): Set<TurnId> {
  const onPath = new Set<TurnId>();
  let cursor = leafTurnId;
  while (cursor !== undefined && !onPath.has(cursor)) {
    const id: TurnId = cursor;
    const turn = session.graphTurns.find((candidate) => candidate.graph.turnId === id);
    if (turn === undefined) break;
    onPath.add(id);
    cursor = turn.graph.parentTurnId ?? undefined;
  }
  return onPath;
}

/** The journal as one final page: every stamped frame of the leaf's lineage in order (session
 * frames without a turn included), plus the daemon's prompt-only placeholder under any turn whose
 * frames hold nothing but its own echo. */
function readMockProjection(
  session: MockSession,
  leafTurnId: TurnId | undefined,
): ConversationReadItem[] {
  const onPath = pathTurnIds(session, leafTurnId);
  const withOutput = new Set<TurnId>();
  for (let i = 0, len = session.journal.length; i < len; i++) {
    const entry = session.journal[i];
    if (entry.turnId !== undefined && entry.event.type !== 'user-message') {
      withOutput.add(entry.turnId);
    }
  }
  const items: ConversationReadItem[] = [];
  for (let i = 0, len = session.journal.length; i < len; i++) {
    const entry = session.journal[i];
    if (entry.turnId !== undefined && !onPath.has(entry.turnId)) continue;
    items.push({
      ...(entry.turnId !== undefined && { turnId: entry.turnId }),
      epoch: entry.epoch,
      seq: entry.seq,
      ts: entry.ts,
      event: projectMockReadEvent(session, entry),
    });
    if (
      entry.turnId !== undefined &&
      entry.event.type === 'user-message' &&
      !withOutput.has(entry.turnId)
    ) {
      items.push({ type: 'history-unavailable', turnId: entry.turnId });
    }
  }
  // A turn refused before it ran journaled nothing; its lineage's read still carries its host user
  // row, the way the daemon reads one from the turn table — and no placeholder: nothing ran.
  const leaf = session.graphTurns.find((turn) => turn.graph.turnId === leafTurnId);
  if (leaf !== undefined && !session.journal.some((entry) => entry.turnId === leaf.graph.turnId)) {
    items.push({
      turnId: leaf.graph.turnId,
      event: {
        type: 'user-message',
        messageId: userRowMessageId(leaf.graph.turnId),
        content: leaf.readContent ?? leaf.content,
      },
    });
  }
  return items;
}

function toSessionInfo(session: MockSession): SessionInfo {
  return {
    sessionId: session.sessionId,
    kind: session.kind,
    cwd: session.cwd,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    title: session.title,
    origin: session.origin,
    ...(MOCK_HISTORY_CAPABILITIES[session.kind] !== undefined && {
      historyCapabilities: MOCK_HISTORY_CAPABILITIES[session.kind],
    }),
  };
}

function isRunningTurn(session: MockSession, epoch: number): boolean {
  return session.epoch === epoch && session.status === 'running';
}

function mockBase64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0, len = binary.length; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function mockBytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0, len = bytes.byteLength; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function mockSha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0, len = view.byteLength; i < len; i++) {
    hex += view[i].toString(16).padStart(2, '0');
  }
  return hex;
}

async function waitForShowcaseStep(session: MockSession, epoch: number): Promise<boolean> {
  await wait(SHOWCASE_SCRIPT_STEP_LATENCY_MS);
  return isRunningTurn(session, epoch);
}

const PATH_SEPARATORS_RE = /[/\\]+/;

function lastPathSegment(cwd: string): string {
  return cwd.split(PATH_SEPARATORS_RE).findLast((part) => part.length > 0) ?? cwd;
}

/** Mirror of the daemon's masked projection: env/header values never reach the client. */
function maskCustomMcpServer(entry: CustomMcpServer): CustomMcpServerPublic {
  const { server } = entry;
  return {
    id: entry.id,
    enabled: entry.enabled,
    createdAt: entry.createdAt,
    server:
      server.type === 'stdio'
        ? {
            type: 'stdio',
            name: server.name,
            command: server.command,
            args: server.args,
            envKeys: Object.keys(server.env ?? {}),
          }
        : {
            type: 'http',
            name: server.name,
            url: server.url,
            headerKeys: Object.keys(server.headers ?? {}),
          },
  };
}

/** Mirror of the daemon's patch semantics: add / enabled flip / per-key secret set-remove /
 * remove. Validation (name uniqueness etc.) is deliberately not replicated in the mock. */
function applyCustomMcpPatches(
  current: CustomMcpServer[],
  ops: readonly CustomMcpServerPatchOp[],
): CustomMcpServer[] {
  let next = structuredClone(current);
  for (let i = 0, len = ops.length; i < len; i++) {
    const op = ops[i];
    switch (op.op) {
      case 'add':
        next.push(structuredClone(op.server));
        break;
      case 'update': {
        const entry = next.find((candidate) => candidate.id === op.id);
        if (!entry) break;
        if (op.enabled !== undefined) entry.enabled = op.enabled;
        if (op.server?.type !== entry.server.type) break;
        entry.server.name = op.server.name;
        if (entry.server.type === 'stdio' && op.server.type === 'stdio') {
          entry.server.command = op.server.command;
          entry.server.args = op.server.args;
          entry.server.env = applyMockSecretPatch(entry.server.env, op.server.env);
        } else if (entry.server.type === 'http' && op.server.type === 'http') {
          entry.server.url = op.server.url;
          entry.server.headers = applyMockSecretPatch(entry.server.headers, op.server.headers);
        }
        break;
      }
      case 'remove':
        next = next.filter((candidate) => candidate.id !== op.id);
        break;
      default:
        break;
    }
  }
  return next;
}

function applyMockSecretPatch(
  current: Record<string, string> | undefined,
  patch: { set?: Record<string, string>; remove?: string[] } | undefined,
): Record<string, string> | undefined {
  if (!patch) return current;
  const removed = new Set(patch.remove);
  const next: Record<string, string> = {};
  const entries = Object.entries({ ...current, ...patch.set });
  for (let i = 0, len = entries.length; i < len; i++) {
    const [key, value] = entries[i];
    if (!removed.has(key)) next[key] = value;
  }
  return next;
}
